import "server-only";
import {
  ProviderError,
  type TrackCandidate,
  type TrackProviderRef,
  appleArtworkUrl,
  bestMatch,
  youtubeSearchQuery,
} from "@vybz/providers";
import { z } from "zod";
import { apple, youtube } from "./providers";
import { TtlCache } from "./ttl-cache";

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  storefront: z
    .string()
    .regex(/^[a-zA-Z]{2}$/)
    .transform((s) => s.toLowerCase()),
});

export const MatchQuerySchema = z.object({
  appleId: z.string().regex(/^\d{1,20}$/),
  storefront: SearchQuerySchema.shape.storefront,
});

/** What the client needs to render a result. Playback is resolved separately per viewer. */
export interface CatalogItem {
  id: string; // provider:externalId until tracks are persisted in Postgres
  title: string;
  artistName: string;
  albumName?: string;
  releaseYear?: number;
  durationMs?: number;
  artworkUrl?: string;
  explicit?: boolean;
  refs: TrackProviderRef[];
}

const searchCache = new TtlCache<CatalogItem[]>(10 * 60_000);
const matchCache = new TtlCache<TrackProviderRef | null>(24 * 60 * 60_000);

/**
 * Apple Music is the primary metadata source (ISRC, release year, artwork).
 * YouTube is the fallback when Apple isn't configured, and otherwise is matched
 * lazily per track so searches don't burn YouTube quota.
 */
export async function searchCatalog(q: string, storefront: string): Promise<CatalogItem[]> {
  const key = `${storefront}:${q.toLowerCase()}`;
  return searchCache.getOrLoad(key, async () => {
    if (apple) return (await apple.search(q, { storefront, limit: 15 })).map(fromCandidate);
    if (youtube) return (await youtube.search(q, { storefront, limit: 10 })).map(fromCandidate);
    return [];
  });
}

export async function matchYouTube(appleId: string, storefront: string): Promise<TrackProviderRef | null> {
  const am = apple;
  const yt = youtube;
  if (!am || !yt) return null;
  return matchCache.getOrLoad(`${storefront}:${appleId}`, async () => {
    const track = await am.getTrack(appleId, { storefront });
    if (!track) return null;
    const candidates = await yt.search(youtubeSearchQuery(track), { storefront, limit: 5 });
    const match = bestMatch(track, candidates);
    return match ? toRef(match.candidate) : null;
  });
}

export function providerErrorStatus(err: unknown): number {
  if (err instanceof ProviderError) return err.status === 403 || err.status === 429 ? 503 : 502;
  return 500;
}

function fromCandidate(c: TrackCandidate): CatalogItem {
  return {
    id: `${c.provider}:${c.externalId}`,
    title: c.title,
    artistName: c.artistName,
    ...(c.albumName ? { albumName: c.albumName } : {}),
    ...(c.releaseYear ? { releaseYear: c.releaseYear } : {}),
    ...(c.durationMs ? { durationMs: c.durationMs } : {}),
    ...(c.artwork ? { artworkUrl: appleArtworkUrl(c.artwork.url, 300) } : {}),
    ...(c.explicit !== undefined ? { explicit: c.explicit } : {}),
    refs: [toRef(c)],
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
