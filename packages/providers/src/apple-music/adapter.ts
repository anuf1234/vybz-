import { z } from "zod";
import {
  type AlbumCandidate,
  type AlbumProvider,
  type ArtistCandidate,
  type BrowseProvider,
  type FetchLike,
  type MetadataProvider,
  type PlaybackProvider,
  type PlaybackSource,
  ProviderError,
  type ReleaseProvider,
  type SearchOptions,
  type ThemeQuery,
  type TrackCandidate,
  type TrackProviderRef,
  type ViewerContext,
} from "../types";

const API_BASE = "https://api.music.apple.com/v1";
const PREVIEW_MAX_MS = 30_000;

// Only the fields we use. Unknown fields are ignored so Apple can add to the payload.
const SongSchema = z.object({
  id: z.string(),
  attributes: z.object({
    name: z.string(),
    artistName: z.string(),
    albumName: z.string().optional(),
    durationInMillis: z.number().optional(),
    isrc: z.string().optional(),
    releaseDate: z.string().optional(),
    genreNames: z.array(z.string()).optional(),
    contentRating: z.string().optional(),
    url: z.string().optional(),
    artwork: z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() }).optional(),
    previews: z.array(z.object({ url: z.string() })).optional(),
  }),
});
type Song = z.infer<typeof SongSchema>;

const SearchResponseSchema = z.object({
  results: z.object({ songs: z.object({ data: z.array(SongSchema) }).optional() }),
});
const SongsResponseSchema = z.object({ data: z.array(SongSchema) });

const ArtistSchema = z.object({
  id: z.string(),
  attributes: z.object({
    name: z.string(),
    genreNames: z.array(z.string()).optional(),
    url: z.string().optional(),
    artwork: z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() }).optional(),
  }),
});
type Artist = z.infer<typeof ArtistSchema>;
const ArtistSearchSchema = z.object({ results: z.object({ artists: z.object({ data: z.array(ArtistSchema) }).optional() }) });
const ArtistsResponseSchema = z.object({ data: z.array(ArtistSchema) });
/** Lists that may mix songs with other kinds (music videos in playlists). */
const MixedListSchema = z.object({ data: z.array(z.object({ type: z.string() }).passthrough()), next: z.string().optional() });
const GenresSchema = z.object({ data: z.array(z.object({ id: z.string(), attributes: z.object({ name: z.string() }) })) });
const ChartsSchema = z.object({ results: z.object({ songs: z.array(z.object({ data: z.array(z.object({ type: z.string() }).passthrough()) })).optional() }) });
const PlaylistSearchSchema = z.object({
  results: z.object({
    playlists: z
      .object({ data: z.array(z.object({ id: z.string(), attributes: z.object({ name: z.string(), curatorName: z.string().optional() }) })) })
      .optional(),
  }),
});

/** Apple Music genre names for each VYBZ genre key, best first. */
export const APPLE_GENRES: Record<string, { names: string[]; label: string }> = {
  rnb: { names: ["R&B/Soul"], label: "R&B" },
  hiphop: { names: ["Hip-Hop/Rap"], label: "Hip-Hop" },
  pop: { names: ["Pop", "K-Pop"], label: "Pop" },
  rock: { names: ["Rock", "Hard Rock", "Metal"], label: "Rock" },
  electronic: { names: ["Electronic", "Dance"], label: "Electronic" },
  country: { names: ["Country"], label: "Country" },
  latin: { names: ["Latin", "Urbano latino", "Música Mexicana"], label: "Latin" },
  reggae: { names: ["Reggae"], label: "Reggae" },
  afrobeats: { names: ["Afrobeats", "African", "Afro-Beat"], label: "Afrobeats" },
  jazz: { names: ["Jazz"], label: "Jazz" },
  funk: { names: ["Funk", "Disco"], label: "Funk" },
  gospel: { names: ["Christian", "Christian & Gospel", "Gospel"], label: "Gospel" },
  indie: { names: ["Alternative", "Indie Pop", "Singer/Songwriter"], label: "Indie" },
};

export interface AppleMusicAdapterConfig {
  /** Returns a valid developer token (see DeveloperTokenCache). */
  developerToken: () => Promise<string>;
  fetch?: FetchLike;
  /** Apple editorial playlists to read new releases from (searched by name). */
  newReleasePlaylists?: string[];
}

/** Apple's editorial new-music playlists. */
export const NEW_RELEASE_PLAYLISTS = ["New Music Daily", "Rap Life", "R&B Now", "A-List: Pop", "New in Afrobeats"];

const AlbumSchema = z.object({
  id: z.string(),
  attributes: z.object({
    name: z.string(),
    artistName: z.string(),
    releaseDate: z.string().optional(),
    genreNames: z.array(z.string()).optional(),
    trackCount: z.number().optional(),
    isSingle: z.boolean().optional(),
    url: z.string().optional(),
    artwork: z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() }).optional(),
  }),
  relationships: z.object({ tracks: z.object({ data: z.array(z.object({ type: z.string() }).passthrough()) }).optional() }).optional(),
});
type Album = z.infer<typeof AlbumSchema>;
const AlbumSearchSchema = z.object({ results: z.object({ albums: z.object({ data: z.array(AlbumSchema) }).optional() }) });
const AlbumsResponseSchema = z.object({ data: z.array(AlbumSchema) });
const AlbumChartsSchema = z.object({ results: z.object({ albums: z.array(z.object({ data: z.array(AlbumSchema) })).optional() }) });

export class AppleMusicAdapter implements MetadataProvider, PlaybackProvider, BrowseProvider, AlbumProvider, ReleaseProvider {
  readonly kind = "APPLE_MUSIC" as const;
  private readonly fetchFn: FetchLike;
  private readonly genreIds = new Map<string, { at: number; byName: Promise<Map<string, string>> }>();

  constructor(private readonly config: AppleMusicAdapterConfig) {
    this.fetchFn = config.fetch ?? fetch;
  }

  async search(query: string, opts: SearchOptions): Promise<TrackCandidate[]> {
    const term = query.trim();
    if (!term) return [];
    const params = new URLSearchParams({
      term,
      types: "songs",
      limit: String(clamp(opts.limit ?? 15, 1, 25)),
    });
    const json = await this.get(`/catalog/${storefront(opts)}/search?${params}`);
    const parsed = SearchResponseSchema.parse(json);
    return (parsed.results.songs?.data ?? []).map(toCandidate);
  }

  async getTrack(externalId: string, opts: SearchOptions): Promise<TrackCandidate | null> {
    const json = await this.get(`/catalog/${storefront(opts)}/songs/${encodeURIComponent(externalId)}`, true);
    if (json === null) return null;
    const song = SongsResponseSchema.parse(json).data[0];
    return song ? toCandidate(song) : null;
  }

  async lookupByIsrc(isrc: string, opts: SearchOptions): Promise<TrackCandidate[]> {
    const params = new URLSearchParams({ "filter[isrc]": isrc.toUpperCase() });
    const json = await this.get(`/catalog/${storefront(opts)}/songs?${params}`, true);
    if (json === null) return [];
    return SongsResponseSchema.parse(json).data.map(toCandidate);
  }

  async searchArtists(query: string, opts: SearchOptions): Promise<ArtistCandidate[]> {
    const term = query.trim();
    if (!term) return [];
    const params = new URLSearchParams({ term, types: "artists", limit: String(clamp(opts.limit ?? 8, 1, 25)) });
    const json = await this.get(`/catalog/${storefront(opts)}/search?${params}`);
    return (ArtistSearchSchema.parse(json).results.artists?.data ?? []).map(toArtist);
  }

  async artistTopSongs(artistId: string, opts: SearchOptions): Promise<{ artist: ArtistCandidate; songs: TrackCandidate[] } | null> {
    const sf = storefront(opts);
    const id = encodeURIComponent(artistId);
    const [artistJson, first] = await Promise.all([
      this.get(`/catalog/${sf}/artists/${id}`, true),
      this.get(`/catalog/${sf}/artists/${id}/view/top-songs?limit=20`, true),
    ]);
    if (artistJson === null) return null;
    const artist = ArtistsResponseSchema.parse(artistJson).data[0];
    if (!artist) return null;
    // Apple orders this view by popularity in the storefront; keep that order.
    const songs = first === null ? [] : songsFrom(first);
    const next = first === null ? undefined : MixedListSchema.parse(first).next;
    const want = clamp(opts.limit ?? 40, 1, 60);
    if (next && songs.length < want) {
      const more = await this.get(next.replace(/^\/v1/, ""), true);
      if (more !== null) songs.push(...songsFrom(more));
    }
    return { artist: toArtist(artist), songs: dedupe(songs).slice(0, want) };
  }

  /**
   * Current most-played songs in the theme's genres; for an era, Apple's own
   * playlists for that decade and genre (e.g. "90s R&B Essentials") plus a
   * song search, since the charts only hold today's hits.
   */
  async suggestions(theme: ThemeQuery, opts: SearchOptions): Promise<TrackCandidate[]> {
    const sf = storefront(opts);
    const genres = theme.genres.slice(0, 3);
    const hasEra = theme.eraFrom !== undefined || theme.eraTo !== undefined;
    const lists: TrackCandidate[][] = [];
    if (!hasEra) {
      const ids = genres.length ? (await Promise.all(genres.map((g) => this.genreId(sf, g)))).filter((x): x is string => x !== null) : [null];
      for (const genre of ids.length ? ids : [null]) {
        const params = new URLSearchParams({ types: "songs", chart: "most-played", limit: "50" });
        if (genre) params.set("genre", genre);
        const json = await this.get(`/catalog/${sf}/charts?${params}`, true);
        if (json === null) continue;
        const charts = ChartsSchema.parse(json).results.songs ?? [];
        lists.push(charts.flatMap((c) => parseSongs(c.data)));
      }
    } else {
      const decades = decadesOf(theme.eraFrom, theme.eraTo).slice(0, 2);
      const labels = genres.length ? genres.map((g) => APPLE_GENRES[g]?.label ?? g) : [""];
      const terms = decades.flatMap((d) => labels.map((l) => `${decadeTerm(d)} ${l}`.trim()));
      for (const term of terms.slice(0, 4)) {
        const [playlistTracks, searched] = await Promise.all([this.playlistTracksFor(sf, term), this.search(term, { ...opts, limit: 25 })]);
        lists.push(playlistTracks, searched);
      }
    }
    return dedupe(interleave(lists)).slice(0, clamp(opts.limit ?? 60, 1, 100));
  }

  private async playlistTracksFor(sf: string, term: string): Promise<TrackCandidate[]> {
    const params = new URLSearchParams({ term, types: "playlists", limit: "10" });
    const found = PlaylistSearchSchema.parse(await this.get(`/catalog/${sf}/search?${params}`)).results.playlists?.data ?? [];
    // Prefer Apple's editorial playlists over user-made ones.
    const ranked = [...found].sort((a, b) => Number(b.attributes.curatorName === "Apple Music") - Number(a.attributes.curatorName === "Apple Music"));
    const pick = ranked[0];
    if (!pick) return [];
    const json = await this.get(`/catalog/${sf}/playlists/${encodeURIComponent(pick.id)}/tracks?limit=100`, true);
    return json === null ? [] : songsFrom(json);
  }

  private async genreId(sf: string, key: string): Promise<string | null> {
    const names = APPLE_GENRES[key]?.names;
    if (!names) return null;
    let cached = this.genreIds.get(sf);
    if (!cached || Date.now() - cached.at > 24 * 3600_000) {
      // Cache the request itself so parallel lookups share one fetch.
      const byName = this.get(`/catalog/${sf}/genres?limit=200`, true).then((json) => {
        const map = new Map<string, string>();
        for (const g of json === null ? [] : GenresSchema.parse(json).data) map.set(g.attributes.name.toLowerCase(), g.id);
        return map;
      });
      byName.catch(() => this.genreIds.delete(sf));
      cached = { at: Date.now(), byName };
      this.genreIds.set(sf, cached);
    }
    const map = await cached.byName;
    for (const n of names) {
      const id = map.get(n.toLowerCase());
      if (id) return id;
    }
    return null;
  }

  async searchAlbums(query: string, opts: SearchOptions): Promise<AlbumCandidate[]> {
    const term = query.trim();
    if (!term) return [];
    const params = new URLSearchParams({ term, types: "albums", limit: String(clamp(opts.limit ?? 15, 1, 25)) });
    const json = await this.get(`/catalog/${storefront(opts)}/search?${params}`);
    return (AlbumSearchSchema.parse(json).results.albums?.data ?? []).map(toAlbum);
  }

  /** One album with its songs in track order. */
  async getAlbum(externalId: string, opts: SearchOptions): Promise<AlbumCandidate | null> {
    const json = await this.get(`/catalog/${storefront(opts)}/albums/${encodeURIComponent(externalId)}?include=tracks`, true);
    if (json === null) return null;
    const album = AlbumsResponseSchema.parse(json).data[0];
    return album ? toAlbum(album) : null;
  }

  /** Albums charting now (Apple's most-played chart for the storefront). */
  async topAlbums(opts: SearchOptions): Promise<AlbumCandidate[]> {
    const params = new URLSearchParams({ types: "albums", chart: "most-played", limit: String(clamp(opts.limit ?? 20, 1, 50)) });
    const json = await this.get(`/catalog/${storefront(opts)}/charts?${params}`, true);
    if (json === null) return [];
    return (AlbumChartsSchema.parse(json).results.albums ?? []).flatMap((c) => c.data.map(toAlbum));
  }

  /**
   * New releases: the album and song charts plus Apple's editorial new-music
   * playlists, interleaved so each source gets a look in. Songs are turned
   * into their release (single, EP or album). Any one source failing is
   * skipped.
   */
  async newReleases(opts: SearchOptions): Promise<AlbumCandidate[]> {
    const sf = storefront(opts);
    const soft = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    const albumChart = soft(this.topAlbums({ ...opts, limit: 50 }));
    const songChart = soft(
      this.get(`/catalog/${sf}/charts?types=songs&chart=most-played&limit=50`, true).then((json) =>
        json === null ? [] : (ChartsSchema.parse(json).results.songs ?? []).flatMap((c) => releasesFromSongs(c.data)),
      ),
    );
    const terms = this.config.newReleasePlaylists ?? NEW_RELEASE_PLAYLISTS;
    const playlists = terms.map((term) => soft(this.editorialPlaylistItems(sf, term).then(releasesFromSongs)));
    const lists = await Promise.all([...playlists, songChart, albumChart]);
    const seen = new Set<string>();
    return interleave(lists).filter((a) => !seen.has(a.externalId) && !!seen.add(a.externalId));
  }

  async latestRelease(artistId: string, opts: SearchOptions): Promise<AlbumCandidate | null> {
    const json = await this.get(`/catalog/${storefront(opts)}/artists/${encodeURIComponent(artistId)}/view/latest-release`, true);
    if (json === null) return null;
    const parsed = AlbumsResponseSchema.safeParse(json);
    const al = parsed.success ? parsed.data.data[0] : undefined;
    return al ? toAlbum(al) : null;
  }

  /** Items of Apple's own playlist by that name (not user playlists). */
  private async editorialPlaylistItems(sf: string, term: string): Promise<{ type: string }[]> {
    const params = new URLSearchParams({ term, types: "playlists", limit: "10" });
    const found = PlaylistSearchSchema.parse(await this.get(`/catalog/${sf}/search?${params}`)).results.playlists?.data ?? [];
    const pick = found.find((p) => p.attributes.curatorName === "Apple Music" && p.attributes.name.toLowerCase() === term.toLowerCase()) ?? found.find((p) => p.attributes.curatorName === "Apple Music");
    if (!pick) return [];
    const json = await this.get(`/catalog/${sf}/playlists/${encodeURIComponent(pick.id)}/tracks?limit=100`, true);
    return json === null ? [] : MixedListSchema.parse(json).data;
  }

  sources(ref: TrackProviderRef, viewer: ViewerContext): PlaybackSource[] {
    const attribution = {
      provider: this.kind,
      label: "Apple Music",
      ...(ref.externalUrl ? { href: ref.externalUrl } : {}),
    };
    const out: PlaybackSource[] = [];

    const subscribed = viewer.connections.some((c) => c.provider === this.kind && c.canPlayFullCatalog);
    if (subscribed) {
      out.push({
        tier: "PROVIDER_FULL",
        provider: this.kind,
        sdk: { kind: "musickit", catalogId: ref.externalId },
        attribution,
        restrictions: { noOverlay: true },
      });
    }
    if (ref.previewUrl) {
      out.push({
        tier: "PREVIEW",
        provider: this.kind,
        url: ref.previewUrl,
        attribution,
        restrictions: { maxPlayMs: PREVIEW_MAX_MS, noOverlay: true },
      });
    }
    if (ref.externalUrl) {
      out.push({
        tier: "LINK_OUT",
        provider: this.kind,
        href: ref.externalUrl,
        attribution,
        restrictions: { noOverlay: true },
      });
    }
    return out;
  }

  /** Returns parsed JSON, or null on 404 when `allowNotFound` is set. */
  private async get(path: string, allowNotFound = false): Promise<unknown> {
    const token = await this.config.developerToken();
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (allowNotFound && res.status === 404) return null;
    if (!res.ok) {
      // Keep the provider's short error text (never the request, which holds credentials) for the logs.
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
      throw new ProviderError(this.kind, res.status, `GET ${path.split("?")[0]} failed with ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.json();
  }
}

/** Apple artwork URLs are templates like `.../{w}x{h}bb.jpg`. */
export function appleArtworkUrl(template: string, size: number): string {
  return template.replace("{w}", String(size)).replace("{h}", String(size));
}

function toCandidate(song: Song): TrackCandidate {
  const a = song.attributes;
  const year = a.releaseDate ? Number.parseInt(a.releaseDate.slice(0, 4), 10) : undefined;
  const previewUrl = a.previews?.[0]?.url;
  return {
    provider: "APPLE_MUSIC",
    externalId: song.id,
    title: a.name,
    artistName: a.artistName,
    ...(a.albumName ? { albumName: a.albumName } : {}),
    ...(a.durationInMillis ? { durationMs: a.durationInMillis } : {}),
    ...(a.isrc ? { isrc: a.isrc } : {}),
    ...(year && Number.isFinite(year) ? { releaseYear: year } : {}),
    // Apple always appends the umbrella "Music" genre; it carries no signal.
    genres: (a.genreNames ?? []).filter((g) => g !== "Music"),
    explicit: a.contentRating === "explicit",
    ...(a.artwork ? { artwork: { url: a.artwork.url, width: a.artwork.width, height: a.artwork.height } } : {}),
    ...(a.url ? { externalUrl: a.url } : {}),
    ...(previewUrl ? { previewUrl } : {}),
  };
}

/** " - Single" / " - EP" on Apple names. */
function formatOf(name: string, isSingle: boolean | undefined): "SINGLE" | "EP" | "ALBUM" {
  if (isSingle || /\s+-\s+Single$/i.test(name)) return "SINGLE";
  if (/\s+-\s+EP$/i.test(name)) return "EP";
  return "ALBUM";
}

/** The release each song in a list comes from, using the album id in the song's Apple Music link. */
function releasesFromSongs(items: readonly { type: string }[]): AlbumCandidate[] {
  const out: AlbumCandidate[] = [];
  for (const item of items) {
    if (item.type !== "songs") continue;
    const parsed = SongSchema.safeParse(item);
    if (!parsed.success) continue;
    const a = parsed.data.attributes;
    const albumId = a.url?.match(/\/album\/(?:[^/]+\/)?(\d+)/)?.[1];
    if (!albumId || !a.albumName) continue;
    const year = a.releaseDate ? Number.parseInt(a.releaseDate.slice(0, 4), 10) : undefined;
    const format = formatOf(a.albumName, undefined);
    out.push({
      provider: "APPLE_MUSIC",
      externalId: albumId,
      title: a.albumName.replace(/\s+-\s+(Single|EP)$/i, ""),
      artistName: a.artistName,
      ...(year && Number.isFinite(year) ? { releaseYear: year } : {}),
      ...(a.releaseDate ? { releaseDate: a.releaseDate } : {}),
      genres: (a.genreNames ?? []).filter((g) => g !== "Music"),
      ...(a.artwork ? { artwork: { url: appleArtworkUrl(a.artwork.url, 600), width: 600, height: 600 } } : {}),
      ...(a.url ? { externalUrl: a.url.replace(/\?.*$/, "") } : {}),
      isSingle: format === "SINGLE",
      format,
    });
  }
  return out;
}

function toAlbum(al: Album): AlbumCandidate {
  const a = al.attributes;
  const year = a.releaseDate ? Number.parseInt(a.releaseDate.slice(0, 4), 10) : undefined;
  const tracks = al.relationships?.tracks?.data ? parseSongs(al.relationships.tracks.data) : undefined;
  return {
    provider: "APPLE_MUSIC",
    externalId: al.id,
    title: a.name.replace(/\s+-\s+(Single|EP)$/i, ""),
    artistName: a.artistName,
    ...(year && Number.isFinite(year) ? { releaseYear: year } : {}),
    ...(a.releaseDate ? { releaseDate: a.releaseDate } : {}),
    genres: (a.genreNames ?? []).filter((g) => g !== "Music"),
    ...(a.artwork ? { artwork: { url: appleArtworkUrl(a.artwork.url, 600), width: 600, height: 600 } } : {}),
    ...(a.url ? { externalUrl: a.url } : {}),
    ...(a.trackCount !== undefined ? { trackCount: a.trackCount } : {}),
    isSingle: a.isSingle ?? false,
    format: formatOf(a.name, a.isSingle),
    ...(tracks ? { tracks } : {}),
  };
}

function toArtist(a: Artist): ArtistCandidate {
  const at = a.attributes;
  return {
    provider: "APPLE_MUSIC",
    externalId: a.id,
    name: at.name,
    genres: (at.genreNames ?? []).filter((g) => g !== "Music"),
    ...(at.artwork ? { artwork: { url: at.artwork.url, width: at.artwork.width, height: at.artwork.height } } : {}),
    ...(at.url ? { externalUrl: at.url } : {}),
  };
}

/** Songs out of a list that may also hold other kinds; malformed entries are skipped. */
function parseSongs(items: readonly { type: string }[]): TrackCandidate[] {
  const out: TrackCandidate[] = [];
  for (const item of items) {
    if (item.type !== "songs") continue;
    const parsed = SongSchema.safeParse(item);
    if (parsed.success) out.push(toCandidate(parsed.data));
  }
  return out;
}

function songsFrom(json: unknown): TrackCandidate[] {
  return parseSongs(MixedListSchema.parse(json).data);
}

function dedupe(list: TrackCandidate[]): TrackCandidate[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const key = c.isrc ?? `${c.title.toLowerCase()}|${c.artistName.toLowerCase()}`;
    if (seen.has(key) || seen.has(c.externalId)) return false;
    seen.add(key);
    seen.add(c.externalId);
    return true;
  });
}

/** Round-robin across lists so every genre or source shows up near the top. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

function decadesOf(from: number | undefined, to: number | undefined): number[] {
  const start = Math.floor((from ?? to ?? 2020) / 10) * 10;
  const end = Math.floor((to ?? from ?? 2020) / 10) * 10;
  const out: number[] = [];
  for (let d = start; d <= end; d += 10) out.push(d);
  return out;
}

function decadeTerm(d: number): string {
  return d < 2000 ? `${String(d).slice(2)}s` : `${d}s`;
}

function storefront(opts: SearchOptions): string {
  const sf = opts.storefront.toLowerCase();
  if (!/^[a-z]{2}$/.test(sf)) throw new Error(`Invalid storefront: ${opts.storefront}`);
  return sf;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
