import type { CatalogHit, TrackView } from "@vybz/core";
import { type Executor, newId, schema, and, eq, inArray } from "@vybz/db";
import {
  type MetadataProvider,
  type ProviderKind,
  type ProviderRegistry,
  type TrackCandidate,
  type TrackProviderRef,
  type ViewerContext,
  appleArtworkUrl,
  bestMatch,
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

export async function searchCatalog(deps: CatalogDeps, q: string, viewer: ViewerContext): Promise<CatalogHit[]> {
  const provider = deps.metadata[0];
  if (!provider) return [];
  const candidates = await provider.search(q, { storefront: viewer.storefront, limit: 15 });
  return candidates.map((c) => {
    const ref = toRef(c);
    return {
      catalogId: `${c.provider}:${c.externalId}`,
      title: c.title,
      artistName: c.artistName,
      ...(c.albumName ? { albumName: c.albumName } : {}),
      ...(c.releaseYear ? { releaseYear: c.releaseYear } : {}),
      ...(c.durationMs ? { durationMs: c.durationMs } : {}),
      ...(c.artwork ? { artworkUrl: artworkFor(c) } : {}),
      ...(c.explicit !== undefined ? { explicit: c.explicit } : {}),
      sources: resolvePlayback([ref], viewer, deps.playback),
    };
  });
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
  if (existing) return existing;

  const provider = deps.metadata.find((m) => m.kind === parsed.provider);
  if (!provider) throw new CatalogError("PROVIDER_UNAVAILABLE");
  const candidate = await provider.getTrack(parsed.externalId, { storefront: deps.storefront });
  if (!candidate) throw new CatalogError("TRACK_NOT_FOUND");

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
