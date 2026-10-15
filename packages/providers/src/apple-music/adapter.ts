import { z } from "zod";
import {
  type FetchLike,
  type MetadataProvider,
  type PlaybackProvider,
  type PlaybackSource,
  ProviderError,
  type SearchOptions,
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

export interface AppleMusicAdapterConfig {
  /** Returns a valid developer token (see DeveloperTokenCache). */
  developerToken: () => Promise<string>;
  fetch?: FetchLike;
}

export class AppleMusicAdapter implements MetadataProvider, PlaybackProvider {
  readonly kind = "APPLE_MUSIC" as const;
  private readonly fetchFn: FetchLike;

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
    if (!res.ok) throw new ProviderError(this.kind, res.status, `GET ${path.split("?")[0]} failed`);
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

function storefront(opts: SearchOptions): string {
  const sf = opts.storefront.toLowerCase();
  if (!/^[a-z]{2}$/.test(sf)) throw new Error(`Invalid storefront: ${opts.storefront}`);
  return sf;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
