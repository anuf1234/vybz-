import { fitsEra } from "@vybz/core";
import { Prisma, type PrismaClient } from "@vybz/db";
import type { TrackCandidate, TrackProviderRef } from "@vybz/providers";
import { AppError } from "../errors";

/** Catalog access battles need. The app wires Apple Music (or the dev sample catalog); tests pass a stub. */
export interface CatalogPort {
  getTrack(appleId: string): Promise<TrackCandidate | null>;
  /** Best-effort YouTube match for embeds; may return null or throw (quota). */
  matchYouTube?(track: TrackCandidate): Promise<TrackProviderRef | null>;
}

export interface ResolvedTrack {
  trackId: string;
  title: string;
}

/**
 * Turns Apple Music catalog ids from the browser into canonical tracks.
 * Metadata always comes from the catalog, never from the client.
 */
export async function resolveLineup(
  prisma: PrismaClient,
  catalog: CatalogPort | null,
  appleIds: string[],
  rules: { eraFrom: number | null; eraTo: number | null },
): Promise<ResolvedTrack[]> {
  if (!catalog) throw new AppError("UNAVAILABLE", "Song search isn't available right now.");
  if (new Set(appleIds).size !== appleIds.length) throw new AppError("INVALID", "Each song can only be in your lineup once.");

  const candidates = await Promise.all(appleIds.map((id) => catalog.getTrack(id)));
  const out: ResolvedTrack[] = [];
  for (const [i, c] of candidates.entries()) {
    if (!c) throw new AppError("INVALID", `We couldn't find song ${i + 1} in your lineup. Pick it again.`);
    if (!fitsEra(rules, c.releaseYear)) {
      throw new AppError("INVALID", `“${c.title}” came out in ${c.releaseYear}, outside this battle's era.`);
    }
    const trackId = await upsertTrack(prisma, c);
    if (catalog.matchYouTube) {
      // Best effort and outside any battle lock: network calls never hold a row lock.
      await attachYouTube(prisma, trackId, c, catalog.matchYouTube).catch(() => undefined);
    }
    out.push({ trackId, title: c.title });
  }
  if (new Set(out.map((t) => t.trackId)).size !== out.length) {
    throw new AppError("INVALID", "Two of your picks are the same recording. Swap one out.");
  }
  return out;
}

/** Finds or creates the canonical track for an Apple Music candidate. */
export async function upsertTrack(prisma: PrismaClient, c: TrackCandidate): Promise<string> {
  const ref = await prisma.musicTrackRef.findUnique({
    where: { provider_externalId: { provider: "APPLE_MUSIC", externalId: c.externalId } },
    select: { trackId: true },
  });
  if (ref) return ref.trackId;

  try {
    // Same recording under another Apple id (another album or storefront): reuse it by ISRC.
    const byIsrc = c.isrc ? await prisma.musicTrack.findUnique({ where: { isrc: c.isrc }, select: { id: true } }) : null;
    if (byIsrc) return byIsrc.id;
    const track = await prisma.musicTrack.create({
      data: {
        title: c.title,
        artistName: c.artistName,
        albumName: c.albumName ?? null,
        isrc: c.isrc ?? null,
        releaseYear: c.releaseYear ?? null,
        durationMs: c.durationMs ?? null,
        artworkUrl: c.artwork?.url ?? null,
        explicit: c.explicit ?? false,
        genres: c.genres ?? [],
        refs: {
          create: {
            provider: "APPLE_MUSIC",
            externalId: c.externalId,
            externalUrl: c.externalUrl ?? null,
            previewUrl: c.previewUrl ?? null,
          },
        },
      },
      select: { id: true },
    });
    return track.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await prisma.musicTrackRef.findUnique({
        where: { provider_externalId: { provider: "APPLE_MUSIC", externalId: c.externalId } },
        select: { trackId: true },
      });
      if (again) return again.trackId;
      const byIsrc = c.isrc ? await prisma.musicTrack.findUnique({ where: { isrc: c.isrc }, select: { id: true } }) : null;
      if (byIsrc) return byIsrc.id;
    }
    throw err;
  }
}

async function attachYouTube(
  prisma: PrismaClient,
  trackId: string,
  candidate: TrackCandidate,
  match: NonNullable<CatalogPort["matchYouTube"]>,
): Promise<void> {
  const has = await prisma.musicTrackRef.findUnique({
    where: { trackId_provider: { trackId, provider: "YOUTUBE" } },
    select: { id: true },
  });
  if (has) return;
  const ref = await match(candidate);
  if (!ref) return;
  await prisma.musicTrackRef.create({
    data: {
      trackId,
      provider: "YOUTUBE",
      externalId: ref.externalId,
      externalUrl: ref.externalUrl ?? null,
      embeddable: ref.embeddable ?? true,
    },
  });
}
