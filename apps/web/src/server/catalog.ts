import { type ArtistHit, type CatalogHit, type TrackView, themeLabel, trackMatchesGenres } from "@vybz/core";
import { type Executor, newId, schema, and, eq, inArray } from "@vybz/db";
import {
  type ArtistCandidate,
  type BrowseProvider,
  type MetadataProvider,
  type ProviderKind,
  type ProviderRegistry,
  type ReleaseYearLookup,
  type ThemeQuery,
  type TrackCandidate,
  type TrackProviderRef,
  type ViewerContext,
  appleArtworkUrl,
  isBrowseProvider,
  appleQueryForVideo,
  bestAppleMatchForVideo,
  bestMatch,
  parseVideoTitle,
  resolvePlayback,
  youtubeSearchQuery,
} from "@vybz/providers";

/**
 * Catalog service: search across the configured metadata providers, and turn
 * a search hit into a canonical track row (de-duplicated by ISRC) with its
 * provider references. Playback stays a per-viewer computation.
 */

export interface CatalogDeps {
  /** Metadata providers in priority order. The first configured one answers searches. */
  metadata: MetadataProvider[];
  playback: ProviderRegistry;
  /** Used to match Apple tracks to YouTube videos at submission time. */
  youtube?: MetadataProvider | null;
  /** Original release years for YouTube picks without an Apple Music match (MusicBrainz). */
  releaseYears?: ReleaseYearLookup | null;
  storefront: string;
}

export const CATALOG_ID = /^(APPLE_MUSIC|YOUTUBE|VYBZ_DEMO):([A-Za-z0-9_-]{1,64})$/;

export function parseCatalogId(id: string): { provider: ProviderKind; externalId: string } | null {
  const m = CATALOG_ID.exec(id);
  return m ? { provider: m[1] as ProviderKind, externalId: m[2]! } : null;
}

export function guestViewer(storefront: string): ViewerContext {
  return { userId: null, storefront, connections: [] };
}

/**
 * What the listener's device can play beyond what everyone gets. Self-reported
 * by the app (e.g. after MusicKit confirms an Apple Music subscription); it only
 * unlocks playback options, never voting rights.
 */
export interface PlaybackCaps {
  appleMusicFull: boolean;
}

export const NO_CAPS: PlaybackCaps = { appleMusicFull: false };

export function viewerContext(storefront: string, caps: PlaybackCaps = NO_CAPS, userId: string | null = null): ViewerContext {
  return {
    userId,
    storefront,
    connections: caps.appleMusicFull ? [{ provider: "APPLE_MUSIC", canPlayFullCatalog: true }] : [],
  };
}

export const PROVIDER_LABEL: Record<ProviderKind, string> = { APPLE_MUSIC: "Apple Music", YOUTUBE: "YouTube", VYBZ_DEMO: "VYBZ demo" };

/** Search one catalog (default: the primary one). */
export async function searchCatalog(deps: CatalogDeps, q: string, viewer: ViewerContext, source?: ProviderKind): Promise<CatalogHit[]> {
  const provider = source ? deps.metadata.find((m) => m.kind === source) : deps.metadata[0];
  if (!provider) return [];
  const candidates = await provider.search(q, { storefront: viewer.storefront, limit: 15 });
  return candidates.map((c) => toHit(deps, c, viewer));
}

function toHit(deps: CatalogDeps, c: TrackCandidate, viewer: ViewerContext): CatalogHit {
  return {
    catalogId: `${c.provider}:${c.externalId}`,
    title: c.title,
    artistName: c.artistName,
    ...(c.albumName ? { albumName: c.albumName } : {}),
    ...(c.releaseYear ? { releaseYear: c.releaseYear } : {}),
    ...(c.durationMs ? { durationMs: c.durationMs } : {}),
    ...(c.artwork ? { artworkUrl: artworkFor(c) } : {}),
    ...(c.explicit !== undefined ? { explicit: c.explicit } : {}),
    sources: resolvePlayback([toRef(c)], viewer, deps.playback),
  };
}

// ── Browsing: artists, top songs, theme suggestions ─────────────────────────

/** The catalog that answers browsing: the first configured one that supports it (Apple Music before the demo). */
export function browseProvider(deps: CatalogDeps): BrowseProvider | null {
  return (deps.metadata.find((m) => isBrowseProvider(m)) as BrowseProvider | undefined) ?? null;
}

export const ARTIST_ID = /^(APPLE_MUSIC|VYBZ_DEMO):([A-Za-z0-9_-]{1,64})$/;

/** Charts and top songs change slowly; cache provider answers per server for a while. */
const BROWSE_TTL_MS = 30 * 60_000;
const browseCache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = browseCache.get(key);
  if (hit && Date.now() - hit.at < BROWSE_TTL_MS) return hit.value as Promise<T>;
  const value = load();
  browseCache.set(key, { at: Date.now(), value });
  value.catch(() => browseCache.delete(key));
  if (browseCache.size > 500) browseCache.delete(browseCache.keys().next().value!);
  return value;
}

/** For tests. */
export function clearBrowseCache() {
  browseCache.clear();
}

function toArtistHit(a: ArtistCandidate): ArtistHit {
  const art = a.artwork ? (a.provider === "APPLE_MUSIC" ? appleArtworkUrl(a.artwork.url, 300) : a.artwork.url) : undefined;
  return { artistId: `${a.provider}:${a.externalId}`, name: a.name, genres: a.genres ?? [], ...(art ? { artworkUrl: art } : {}) };
}

export async function searchArtists(deps: CatalogDeps, q: string, viewer: ViewerContext): Promise<ArtistHit[]> {
  const p = browseProvider(deps);
  if (!p) return [];
  const found = await cached(`artists:${p.kind}:${viewer.storefront}:${q.toLowerCase()}`, () => p.searchArtists(q, { storefront: viewer.storefront, limit: 8 }));
  return found.map(toArtistHit);
}

export async function artistDetail(deps: CatalogDeps, artistId: string, viewer: ViewerContext): Promise<{ artist: ArtistHit; topSongs: CatalogHit[] } | null> {
  const m = ARTIST_ID.exec(artistId);
  if (!m) return null;
  const p = deps.metadata.find((x) => x.kind === m[1] && isBrowseProvider(x)) as BrowseProvider | undefined;
  if (!p) return null;
  const res = await cached(`top:${artistId}:${viewer.storefront}`, () => p.artistTopSongs(m[2]!, { storefront: viewer.storefront, limit: 40 }));
  if (!res) return null;
  return { artist: toArtistHit(res.artist), topSongs: res.songs.map((c) => toHit(deps, c, viewer)) };
}

/** Whether a candidate passes a battle's genre and era rules, judged the way submissions are. */
export function fitsTheme(c: TrackCandidate, theme: ThemeQuery): boolean {
  if (theme.eraFrom !== undefined || theme.eraTo !== undefined) {
    if (c.releaseYear === undefined) return false;
    if ((theme.eraFrom !== undefined && c.releaseYear < theme.eraFrom) || (theme.eraTo !== undefined && c.releaseYear > theme.eraTo)) return false;
  }
  return !theme.genres.length || trackMatchesGenres(c.genres, theme.genres) !== false;
}

export async function suggestionsFor(deps: CatalogDeps, theme: ThemeQuery, viewer: ViewerContext): Promise<{ title: string; items: CatalogHit[] }> {
  const label = themeLabel({ genres: theme.genres, eraFrom: theme.eraFrom, eraTo: theme.eraTo });
  const title = label ? `Suggested for ${label}` : "Popular right now";
  const p = browseProvider(deps);
  if (!p) return { title, items: [] };
  const key = `suggest:${p.kind}:${viewer.storefront}:${[...theme.genres].sort().join(",")}:${theme.eraFrom ?? ""}-${theme.eraTo ?? ""}`;
  const candidates = await cached(key, () => p.suggestions(theme, { storefront: viewer.storefront, limit: 80 }));
  const items = candidates
    .filter((c) => fitsTheme(c, theme))
    .slice(0, 40)
    .map((c) => toHit(deps, c, viewer))
    // A guest has to be able to hear it, same as for submissions.
    .filter((h) => h.sources.some((s) => s.tier !== "LINK_OUT"));
  return { title, items };
}

export interface StoredTrack {
  track: typeof schema.track.$inferSelect;
  refs: TrackProviderRef[];
}

export class CatalogError extends Error {
  constructor(
    readonly code: "INVALID_CATALOG_ID" | "PROVIDER_UNAVAILABLE" | "TRACK_NOT_FOUND",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CatalogError";
  }
}

/**
 * The canonical track for a catalog id, creating it (and its refs) on first use.
 * Apple tracks are matched to a YouTube video once, here, so battles can offer
 * the full-song embed to everyone.
 */
export async function ensureTrack(db: Executor, deps: CatalogDeps, catalogId: string): Promise<StoredTrack> {
  const parsed = parseCatalogId(catalogId);
  if (!parsed) throw new CatalogError("INVALID_CATALOG_ID");

  const existing = await findByRef(db, parsed.provider, parsed.externalId);
  if (existing) return existing.track.releaseYear === null ? await fillMissingYear(db, deps, existing) : existing;

  const provider = deps.metadata.find((m) => m.kind === parsed.provider);
  if (!provider) throw new CatalogError("PROVIDER_UNAVAILABLE");
  const candidate = await provider.getTrack(parsed.externalId, { storefront: deps.storefront });
  if (!candidate) throw new CatalogError("TRACK_NOT_FOUND");

  // A YouTube pick: find the same recording on Apple Music so Apple listeners can
  // hear it too, and so it gets a release year and genres for battle rules.
  const apple = deps.metadata.find((m) => m.kind === "APPLE_MUSIC");
  if (candidate.provider === "YOUTUBE" && apple) {
    try {
      const results = await apple.search(appleQueryForVideo(candidate), { storefront: deps.storefront, limit: 10 });
      const match = bestAppleMatchForVideo(candidate, results);
      if (match) {
        const appleTrack = await ensureTrack(db, { ...deps, youtube: null }, `APPLE_MUSIC:${match.candidate.externalId}`);
        await insertRef(db, appleTrack.track.id, toRef(candidate));
        return (await findByRef(db, "YOUTUBE", candidate.externalId))!;
      }
    } catch (err) {
      console.warn("apple match failed", err);
    }
  }

  // A YouTube video's date is when it was uploaded, not when the song came out.
  // Without an Apple Music match, look the original release year up.
  if (candidate.provider === "YOUTUBE" && candidate.releaseYear === undefined) {
    const year = await lookUpReleaseYear(deps, candidate);
    if (year) candidate.releaseYear = year;
  }

  let trackId: string | null = null;
  if (candidate.isrc) {
    const [byIsrc] = await db.select({ id: schema.track.id }).from(schema.track).where(eq(schema.track.isrc, candidate.isrc.toUpperCase()));
    trackId = byIsrc?.id ?? null;
  }
  if (!trackId) {
    trackId = newId();
    await db.insert(schema.track).values({
      id: trackId,
      title: candidate.title,
      artistName: candidate.artistName,
      albumName: candidate.albumName ?? null,
      isrc: candidate.isrc?.toUpperCase() ?? null,
      releaseYear: candidate.releaseYear ?? null,
      durationMs: candidate.durationMs ?? null,
      artworkUrl: candidate.artwork ? artworkFor(candidate) : null,
      explicit: candidate.explicit ?? false,
      genres: candidate.genres ?? [],
    });
  }
  await insertRef(db, trackId, toRef(candidate));

  if (candidate.provider === "APPLE_MUSIC" && deps.youtube) {
    try {
      const videos = await deps.youtube.search(youtubeSearchQuery(candidate), { storefront: deps.storefront, limit: 5 });
      const match = bestMatch(candidate, videos);
      if (match) await insertRef(db, trackId, toRef(match.candidate));
    } catch (err) {
      // A missing video only means fewer playback options; the track still works via previews.
      console.warn("youtube match failed", err);
    }
  }

  const stored = await findByRef(db, parsed.provider, parsed.externalId);
  if (!stored) throw new CatalogError("TRACK_NOT_FOUND");
  return stored;
}

async function lookUpReleaseYear(deps: CatalogDeps, video: Pick<TrackCandidate, "title" | "artistName">): Promise<number | null> {
  if (!deps.releaseYears) return null;
  const { artist, title } = parseVideoTitle(video);
  try {
    return await deps.releaseYears.firstReleaseYear(artist, title);
  } catch (err) {
    console.warn("release year lookup failed", err);
    return null;
  }
}

/**
 * A stored YouTube-only track without a release year (never found, or cleared
 * because it held the upload year): try an Apple Music match, then MusicBrainz,
 * and save what's found.
 */
async function fillMissingYear(db: Executor, deps: CatalogDeps, stored: StoredTrack): Promise<StoredTrack> {
  const yt = stored.refs.find((r) => r.provider === "YOUTUBE");
  if (!yt || stored.refs.some((r) => r.provider !== "YOUTUBE")) return stored;
  const video = { title: stored.track.title, artistName: stored.track.artistName };
  let year: number | null = null;
  let genres: string[] | null = null;
  const apple = deps.metadata.find((m) => m.kind === "APPLE_MUSIC");
  if (apple) {
    try {
      const results = await apple.search(appleQueryForVideo(video), { storefront: deps.storefront, limit: 10 });
      const match = bestAppleMatchForVideo({ provider: "YOUTUBE", externalId: yt.externalId, ...video, ...(stored.track.durationMs ? { durationMs: stored.track.durationMs } : {}) }, results);
      if (match?.candidate.releaseYear) {
        year = match.candidate.releaseYear;
        genres = match.candidate.genres ?? null;
        // Link the Apple recording too, unless it already belongs to another track.
        if (!(await findByRef(db, "APPLE_MUSIC", match.candidate.externalId))) await insertRef(db, stored.track.id, toRef(match.candidate));
      }
    } catch (err) {
      console.warn("apple match failed", err);
    }
  }
  year ??= await lookUpReleaseYear(deps, video);
  if (!year) return stored;
  await db
    .update(schema.track)
    .set({ releaseYear: year, ...(genres?.length && !stored.track.genres.length ? { genres } : {}) })
    .where(eq(schema.track.id, stored.track.id));
  return (await findByRef(db, "YOUTUBE", yt.externalId))!;
}

export async function refsForTracks(db: Executor, trackIds: string[]): Promise<Map<string, TrackProviderRef[]>> {
  const out = new Map<string, TrackProviderRef[]>();
  if (!trackIds.length) return out;
  const rows = await db.select().from(schema.trackProviderRef).where(inArray(schema.trackProviderRef.trackId, trackIds));
  for (const r of rows) {
    const list = out.get(r.trackId) ?? [];
    list.push(rowToRef(r));
    out.set(r.trackId, list);
  }
  return out;
}

export function toTrackView(t: typeof schema.track.$inferSelect): TrackView {
  return {
    id: t.id,
    title: t.title,
    artistName: t.artistName,
    albumName: t.albumName,
    releaseYear: t.releaseYear,
    durationMs: t.durationMs,
    artworkUrl: t.artworkUrl,
    explicit: t.explicit,
  };
}

async function findByRef(db: Executor, provider: ProviderKind, externalId: string): Promise<StoredTrack | null> {
  const [ref] = await db
    .select({ trackId: schema.trackProviderRef.trackId })
    .from(schema.trackProviderRef)
    .where(and(eq(schema.trackProviderRef.provider, provider), eq(schema.trackProviderRef.externalId, externalId)));
  if (!ref) return null;
  const [track] = await db.select().from(schema.track).where(eq(schema.track.id, ref.trackId));
  if (!track) return null;
  return { track, refs: (await refsForTracks(db, [track.id])).get(track.id) ?? [] };
}

async function insertRef(db: Executor, trackId: string, ref: TrackProviderRef) {
  await db
    .insert(schema.trackProviderRef)
    .values({
      id: newId(),
      trackId,
      provider: ref.provider,
      externalId: ref.externalId,
      externalUrl: ref.externalUrl ?? null,
      previewUrl: ref.previewUrl ?? null,
      embeddable: ref.embeddable ?? null,
    })
    .onConflictDoNothing();
}

function rowToRef(r: typeof schema.trackProviderRef.$inferSelect): TrackProviderRef {
  return {
    provider: r.provider,
    externalId: r.externalId,
    ...(r.externalUrl ? { externalUrl: r.externalUrl } : {}),
    ...(r.previewUrl ? { previewUrl: r.previewUrl } : {}),
    ...(r.embeddable !== null ? { embeddable: r.embeddable } : {}),
  };
}

function toRef(c: TrackCandidate): TrackProviderRef {
  return {
    provider: c.provider,
    externalId: c.externalId,
    ...(c.externalUrl ? { externalUrl: c.externalUrl } : {}),
    ...(c.previewUrl ? { previewUrl: c.previewUrl } : {}),
    ...(c.embeddable !== undefined ? { embeddable: c.embeddable } : {}),
  };
}

function artworkFor(c: TrackCandidate): string {
  const url = c.artwork!.url;
  return c.provider === "APPLE_MUSIC" ? appleArtworkUrl(url, 600) : url;
}
