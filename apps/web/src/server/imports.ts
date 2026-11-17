import type { ImportPlaylistResponse } from "@vybz/core";
import { schema } from "@vybz/db";
import { YouTubeAdapter, playlistIdFromUrl } from "@vybz/providers";
import { z } from "zod";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { ensureTrack } from "./catalog";
import { newInviteCode } from "./battles/access";

/**
 * Import a YouTube playlist as a VYBZ playlist. Each video becomes a canonical
 * track (matched to Apple Music where possible, so it gets a release year and
 * genres and can be picked in battles). Up to IMPORT_MAX songs per import.
 */

export const IMPORT_MAX = 100;
const CONCURRENCY = 5;

const Schema = z.object({ url: z.string().trim().min(5).max(500) }).strict();

export async function importYouTubePlaylist(deps: BattleDeps, user: UserRow | null, body: unknown): Promise<ImportPlaylistResponse> {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", "Paste a YouTube playlist link.");
  const listId = playlistIdFromUrl(parsed.data.url);
  if (!listId) throw new ServiceError(400, "INVALID_PLAYLIST_LINK", "That doesn't look like a YouTube playlist link. It should contain list=…");
  const yt = deps.catalog.metadata.find((m): m is YouTubeAdapter => m instanceof YouTubeAdapter);
  if (!yt) throw new ServiceError(409, "IMPORT_UNAVAILABLE", "YouTube isn't set up on this server.");

  let list: Awaited<ReturnType<YouTubeAdapter["playlist"]>>;
  try {
    list = await yt.playlist(listId, IMPORT_MAX);
  } catch (err) {
    console.warn("youtube playlist fetch failed", err);
    throw new ServiceError(503, "PROVIDER_UNAVAILABLE");
  }
  if (!list) throw new ServiceError(404, "PLAYLIST_NOT_FOUND", "We couldn't open that playlist. Is it public or unlisted?");

  // Resolve songs a few at a time, keeping the playlist's order.
  const trackIds: (string | null)[] = new Array(list.videoIds.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < list!.videoIds.length) {
        const i = next++;
        try {
          trackIds[i] = (await ensureTrack(deps.db, { ...deps.catalog, youtube: null }, `YOUTUBE:${list!.videoIds[i]}`)).track.id;
        } catch {
          trackIds[i] = null; // removed, private or not embeddable
        }
      }
    }),
  );
  const unique = [...new Set(trackIds.filter((t): t is string => Boolean(t)))];

  const id = newInviteCode() + newInviteCode().slice(0, 4);
  const title = list.title.trim().slice(0, 80) || "YouTube playlist";
  await deps.db.transaction(async (tx) => {
    await tx.insert(schema.playlist).values({ id, ownerId: user.id, title, description: "Imported from YouTube", visibility: "PRIVATE", shareCode: newInviteCode() });
    if (unique.length) await tx.insert(schema.playlistTrack).values(unique.map((trackId, position) => ({ playlistId: id, trackId, position, addedById: user.id })));
  });
  return { playlistId: id, title, imported: unique.length, skipped: list.videoIds.length - unique.length };
}
