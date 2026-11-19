import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { MusicLinkStatus } from "@vybz/core";
import { type Executor, and, asc, eq, gte, inArray, isNull, lt, or, schema, sql } from "@vybz/db";
import { ProviderError } from "@vybz/providers";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { requireEnv } from "./env";

/**
 * "Count my plays": with a person's opt-in, VYBZ reads their recently
 * played Apple Music songs a few times a day and counts plays of current
 * Daily Drops (one per person per release per UTC day) toward Song of the
 * Day / Week and Album of the Week. Nobody's plays are shown in the app;
 * only de-identified totals per release are kept (release_day_stats). The Music User Token is stored encrypted
 * and deleted when they switch it off.
 */

/** How the server reads a person's listening (the Apple Music adapter, or a stand-in in tests). */
export interface RecentPlays {
  recentlyPlayed(userToken: string): Promise<{ songId: string; albumId: string | null; title: string; artistName: string }[]>;
}

export interface MusicDeps {
  /** Developer token for the app's MusicKit user-token request; null when Apple Music isn't set up. */
  appDeveloperToken: (() => Promise<string>) | null;
  reader: RecentPlays | null;
}

const SYNC_EVERY_MS = 4 * 3600_000;
const PER_RUN = 40;

function key(): Buffer {
  return createHash("sha256").update(`${requireEnv("BETTER_AUTH_SECRET")}:music-user-token`).digest();
}

export function sealToken(token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function openToken(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!), d.final()]).toString("utf8");
}

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  return user;
}

export async function musicLinkStatus(deps: BattleDeps, m: MusicDeps, viewer: UserRow | null): Promise<MusicLinkStatus> {
  const user = requireUser(viewer);
  const [link] = await deps.db.select({ userId: schema.musicLink.userId }).from(schema.musicLink).where(eq(schema.musicLink.userId, user.id));
  return { available: !!(m.appDeveloperToken && m.reader), linked: !!link };
}

/** The developer token the app hands to MusicKit to get this person's Music User Token. */
export async function appleDeveloperTokenFor(m: MusicDeps, viewer: UserRow | null): Promise<{ token: string }> {
  requireUser(viewer);
  if (!m.appDeveloperToken) throw new ServiceError(503, "APPLE_MUSIC_UNAVAILABLE", "Apple Music isn't set up on this server.");
  return { token: await m.appDeveloperToken() };
}

/** `{ userToken }`: turn on "Count my plays". Checks the token works before saving it. */
export async function linkAppleMusic(deps: BattleDeps, m: MusicDeps, viewer: UserRow | null, body: unknown, now = new Date()): Promise<MusicLinkStatus> {
  const user = requireUser(viewer);
  if (!m.reader) throw new ServiceError(503, "APPLE_MUSIC_UNAVAILABLE", "Apple Music isn't set up on this server.");
  const token = (body as { userToken?: unknown } | null)?.userToken;
  if (typeof token !== "string" || token.length < 20 || token.length > 4000) throw new ServiceError(400, "INVALID_TOKEN");
  let recent: Awaited<ReturnType<RecentPlays["recentlyPlayed"]>>;
  try {
    recent = await m.reader.recentlyPlayed(token);
  } catch (err) {
    if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) throw new ServiceError(400, "INVALID_TOKEN", "Apple Music didn't accept that. Try connecting again.");
    throw new ServiceError(502, "APPLE_MUSIC_UNAVAILABLE", "Couldn't reach Apple Music. Try again in a moment.");
  }
  // Start from what they've already played, so only plays from now on count.
  const values = { userId: user.id, tokenEnc: sealToken(token), lastSeen: recent.map((r) => r.songId), lastSyncAt: now };
  await deps.db.insert(schema.musicLink).values(values).onConflictDoUpdate({ target: schema.musicLink.userId, set: values });
  return musicLinkStatus(deps, m, user);
}

/** Turn it off: forget the token. Plays already counted stay in the totals. */
export async function unlinkAppleMusic(deps: BattleDeps, m: MusicDeps, viewer: UserRow | null): Promise<MusicLinkStatus> {
  const user = requireUser(viewer);
  await deps.db.delete(schema.musicLink).where(eq(schema.musicLink.userId, user.id));
  return musicLinkStatus(deps, m, user);
}

/**
 * Songs played since the last sync: everything above the newest song we saw
 * last time. (Apple's recently played list has no timestamps.)
 */
export function newPlays(current: string[], lastSeen: string[]): string[] {
  if (!lastSeen.length) return current;
  for (let i = 0; i < current.length; i++) {
    // The first run of 3 (or the end of the list) matching what we saw marks where old plays start.
    const run = lastSeen.slice(0, 3);
    if (current.slice(i, i + run.length).join("|") === run.join("|")) return current.slice(0, i);
  }
  return current;
}

/** Scheduler: reads due links (every few hours each) and records verified plays of current drops. */
export async function syncPlays(deps: BattleDeps, m: MusicDeps, now = new Date()): Promise<number> {
  if (!m.reader) return 0;
  const due = await deps.db
    .select()
    .from(schema.musicLink)
    .where(or(isNull(schema.musicLink.lastSyncAt), lt(schema.musicLink.lastSyncAt, new Date(now.getTime() - SYNC_EVERY_MS))))
    .orderBy(asc(schema.musicLink.lastSyncAt))
    .limit(PER_RUN);
  let recorded = 0;
  const day = now.toISOString().slice(0, 10);
  for (const link of due) {
    let recent: Awaited<ReturnType<RecentPlays["recentlyPlayed"]>>;
    try {
      recent = await m.reader.recentlyPlayed(openToken(link.tokenEnc));
    } catch (err) {
      if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) {
        // The token expired or was revoked: forget it; they can reconnect.
        await deps.db.delete(schema.musicLink).where(eq(schema.musicLink.userId, link.userId));
      } else {
        console.error("play sync failed", link.userId, err);
        await deps.db.update(schema.musicLink).set({ lastSyncAt: now }).where(eq(schema.musicLink.userId, link.userId));
      }
      continue;
    }
    const fresh = new Set(newPlays(recent.map((r) => r.songId), link.lastSeen as string[]));
    const albums = [...new Set(recent.filter((r) => fresh.has(r.songId) && r.albumId).map((r) => r.albumId!))];
    if (albums.length) {
      const drops = await deps.db
        .select({ id: schema.release.id })
        .from(schema.release)
        .where(and(eq(schema.release.provider, "APPLE_MUSIC"), inArray(schema.release.externalId, albums), eq(schema.release.status, "LIVE")));
      if (drops.length) {
        const rows = await deps.db
          .insert(schema.playEvent)
          .values(drops.map((d) => ({ userId: link.userId, releaseId: d.id, day, source: "APPLE_MUSIC", createdAt: now })))
          .onConflictDoNothing()
          .returning();
        recorded += rows.length;
      }
    }
    await deps.db
      .update(schema.musicLink)
      .set({ lastSeen: recent.map((r) => r.songId), lastSyncAt: now })
      .where(eq(schema.musicLink.userId, link.userId));
  }
  return recorded;
}

/** Verified plays per release in a window (people, not repeat plays). */
export async function playsIn(db: Executor, start: Date, end: Date, releaseIds?: string[]): Promise<Map<string, number>> {
  const conds = [gte(schema.playEvent.createdAt, start), lt(schema.playEvent.createdAt, end)];
  if (releaseIds) conds.push(inArray(schema.playEvent.releaseId, releaseIds));
  const rows = await db
    .select({ id: schema.playEvent.releaseId, n: sql<number>`count(distinct ${schema.playEvent.userId})::int` })
    .from(schema.playEvent)
    .where(and(...conds))
    .groupBy(schema.playEvent.releaseId);
  return new Map(rows.map((r) => [r.id, r.n]));
}
