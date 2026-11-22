import {
  type ArtistFollowHit,
  DROPS,
  type DropsResponse,
  type FollowedArtist,
  type ReleaseKind,
  type ReleaseSource,
  type ReleaseView,
  type TodayView,
  VERDICT,
  isFresh,
  verdictScore,
  mixtapeHost,
  releaseKind,
} from "@vybz/core";
import { type Executor, and, asc, desc, eq, gte, inArray, isNotNull, lt, newId, or, schema, sql } from "@vybz/db";
import { type AlbumCandidate, type AlbumProvider, type BrowseProvider, type ReleaseProvider, isAlbumProvider, isBrowseProvider, isReleaseProvider } from "@vybz/providers";
import { isStaff } from "./battles/access";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { botUser } from "./bot";
import { createNotifications, type NewNotification, type PushSender } from "./notifications";
import { grant, localDay, shiftDay, systemIds, validTimeZone } from "./progression";
import { recordActivity, vybzStreak } from "./vybz-streak";
import { createWar } from "./wars";

/**
 * Daily Drops. Once a UTC day (after DROPS.postHourUtc) the scheduler gathers
 * new releases from the provider (charts, editorial new-music playlists, and
 * the latest release of artists people follow), keeps the ones out in the last
 * two weeks, posts the day's biggest from the VYBZ account, opens an album war
 * and a single war between the two biggest of each, and tells followers when
 * an artist they follow dropped. Mixtapes are links people submit; moderators
 * approve them. VYBZ only links out; it never hosts audio.
 */

export type ReleaseRow = typeof schema.release.$inferSelect;

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  // Guests can play battles they were invited to; voting, posting and the rest need a saved account.
  if (user.isAnonymous) throw new ServiceError(403, "GUEST_ACCOUNT", "Save your account to do that.");
  return user;
}

function requireStaff(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!isStaff(user)) throw new ServiceError(403, "FORBIDDEN");
  return user;
}

function providerOf<T extends { kind: string }>(deps: BattleDeps, test: (p: unknown) => boolean): T | null {
  const all = deps.catalog.metadata.filter(test) as unknown as T[];
  return all.find((p) => p.kind === "APPLE_MUSIC") ?? all[0] ?? null;
}
const releaseProvider = (deps: BattleDeps) => providerOf<ReleaseProvider>(deps, isReleaseProvider);
const browseProvider = (deps: BattleDeps) => providerOf<BrowseProvider>(deps, isBrowseProvider);

export const utcDayOf = (d: Date) => d.toISOString().slice(0, 10);
const kindOf = (a: AlbumCandidate): ReleaseKind => a.format ?? releaseKind(a);
const norm = (s: string) => s.trim().toLowerCase();

// ── The daily run ──────────────────────────────────────────────────────────

export interface DropRunResult {
  ran: boolean;
  found: number;
  added: number;
  postId: string | null;
  wars: number;
  notified: number;
  note: string;
}

/** Runs once per UTC day after the post hour. `force` ignores the hour (tests, staff). */
export async function runDailyDrops(deps: BattleDeps, opts: { now?: Date; force?: boolean } = {}): Promise<DropRunResult> {
  const now = opts.now ?? new Date();
  const day = utcDay(now);
  const none: DropRunResult = { ran: false, found: 0, added: 0, postId: null, wars: 0, notified: 0, note: "" };
  if (!opts.force && now.getUTCHours() < DROPS.postHourUtc) return { ...none, note: "Not time yet." };
  const [claimed] = await deps.db.insert(schema.dropRun).values({ day, createdAt: now }).onConflictDoNothing().returning();
  if (!claimed) return { ...none, note: "Already ran today." };

  const p = releaseProvider(deps);
  if (!p) {
    await deps.db.update(schema.dropRun).set({ note: "No music provider is set up." }).where(eq(schema.dropRun.day, day));
    return { ...none, ran: true, note: "No music provider is set up." };
  }
  const sf = { storefront: deps.catalog.storefront };
  const found: { a: AlbumCandidate; source: ReleaseSource }[] = [];
  let failed = false;
  try {
    for (const a of await p.newReleases({ ...sf, limit: 100 })) found.push({ a, source: "CHART" });
  } catch (err) {
    failed = true;
    console.error("new releases failed", err);
  }
  // Latest release of the most-followed artists.
  const f = schema.artistFollow;
  const artists = await deps.db
    .select({ externalId: f.externalId, n: sql<number>`count(*)::int` })
    .from(f)
    .where(eq(f.provider, p.kind))
    .groupBy(f.externalId)
    .orderBy(desc(sql`count(*)`))
    .limit(DROPS.maxArtistChecks);
  for (let i = 0; i < artists.length; i += 5) {
    const batch = await Promise.all(artists.slice(i, i + 5).map((x) => p.latestRelease(x.externalId, sf).catch(() => null)));
    for (const a of batch) if (a) found.push({ a, source: "ARTIST" });
  }

  const fresh = found.filter(({ a }) => isFresh(a.releaseDate, day));
  const added: ReleaseRow[] = [];
  for (const [rank, { a, source }] of fresh.entries()) {
    const [row] = await deps.db
      .insert(schema.release)
      .values({
        id: newId(),
        provider: a.provider,
        externalId: a.externalId,
        kind: kindOf(a),
        title: a.title.slice(0, 200),
        artistName: a.artistName.slice(0, 200),
        artworkUrl: a.artwork?.url ?? null,
        externalUrl: a.externalUrl ?? null,
        releaseDate: a.releaseDate?.slice(0, 10) ?? null,
        genres: (a.genres ?? []).slice(0, 5),
        trackCount: a.trackCount ?? null,
        source,
        status: "LIVE",
        dropDay: day,
        rank,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (row) added.push(row);
  }

  const postId = added.length ? await postDrops(deps, day, added, now) : null;
  const wars = added.length ? await openDropWars(deps, added) : 0;
  const notified = added.length ? await notifyFollowers(deps.db, deps.push, added) : 0;
  const note = failed ? "The music provider didn't answer; only followed artists were checked." : `${added.length} new drops.`;
  await deps.db.update(schema.dropRun).set({ postId, found: added.length, note }).where(eq(schema.dropRun.day, day));
  return { ran: true, found: fresh.length, added: added.length, postId, wars, notified, note };
}

const KIND_ICON: Record<ReleaseKind, string> = { SINGLE: "🎵", EP: "📀", ALBUM: "💿", MIXTAPE: "📼" };

/** The day's post from the VYBZ account. */
async function postDrops(deps: BattleDeps, day: string, rows: ReleaseRow[], now: Date): Promise<string | null> {
  try {
    const bot = await botUser(deps);
    const top = [...rows].sort((a, b) => kindWeight(b.kind) - kindWeight(a.kind) || a.rank - b.rank).slice(0, DROPS.perPost);
    const lines = top.map((r) => `${KIND_ICON[r.kind as ReleaseKind]} ${r.title} by ${r.artistName}`);
    const more = rows.length - top.length;
    const body = [`🆕 Today's drops (${day})`, "", ...lines, ...(more > 0 ? ["", `+ ${more} more in Daily Drops.`] : []), "", "🔥 the ones you're playing and start a war."].join("\n");
    const id = newId();
    await deps.db.insert(schema.post).values({ id, authorId: bot.id, body: body.slice(0, 2000), createdAt: now });
    return id;
  } catch (err) {
    console.error("drops post failed", err);
    return null;
  }
}

/** Albums first in the post, then EPs, then singles. */
function kindWeight(k: string): number {
  return k === "ALBUM" ? 3 : k === "EP" ? 2 : k === "MIXTAPE" ? 1.5 : 1;
}

/** The two biggest new albums face off, and the two biggest singles. */
async function openDropWars(deps: BattleDeps, rows: ReleaseRow[]): Promise<number> {
  let opened = 0;
  const bot = await botUser(deps).catch(() => null);
  if (!bot) return 0;
  for (const kind of ["ALBUM", "SINGLE"] as const) {
    const pair = rows
      .filter((r) => r.kind === kind && r.provider !== "SUBMISSION")
      .sort((a, b) => a.rank - b.rank)
      .filter((r, i, all) => all.findIndex((x) => norm(x.artistName) === norm(r.artistName)) === i)
      .slice(0, 2);
    if (pair.length < 2) continue;
    try {
      const [a, b] = await Promise.all(pair.map((r) => warRef(deps, r)));
      if (!a || !b) continue;
      const war = await createWar(deps, bot, { kind, a, b });
      await deps.db.update(schema.release).set({ warId: war.id }).where(inArray(schema.release.id, [pair[0]!.id, pair[1]!.id]));
      opened++;
    } catch (err) {
      console.error("drop war failed", kind, err);
    }
  }
  return opened;
}

/** Albums are warred as albums; a single's war uses its (first) song. */
export async function warRef(deps: BattleDeps, r: ReleaseRow): Promise<string | null> {
  const ref = `${r.provider}:${r.externalId}`;
  if (r.kind !== "SINGLE") return ref;
  const p = providerOf<AlbumProvider>(deps, isAlbumProvider);
  if (!p || p.kind !== r.provider) return null;
  const al = await p.getAlbum(r.externalId, { storefront: deps.catalog.storefront }).catch(() => null);
  const song = al?.tracks?.[0];
  return song ? `${song.provider}:${song.externalId}` : null;
}

/** One notification per follower: "X dropped …" (or "X and 2 more"). Matches by artist name. */
async function notifyFollowers(db: Executor, push: PushSender | null | undefined, rows: ReleaseRow[]): Promise<number> {
  const names = [...new Set(rows.map((r) => norm(r.artistName)))];
  if (!names.length) return 0;
  const f = schema.artistFollow;
  const follows = await db
    .selectDistinct({ userId: f.userId, name: f.name })
    .from(f)
    .where(inArray(sql`lower(${f.name})`, names));
  const byUser = new Map<string, ReleaseRow[]>();
  for (const fo of follows) {
    const hits = rows.filter((r) => norm(r.artistName) === norm(fo.name));
    const list = byUser.get(fo.userId) ?? [];
    for (const h of hits) if (!list.includes(h)) list.push(h);
    byUser.set(fo.userId, list);
  }
  const items: NewNotification[] = [...byUser.entries()].map(([userId, list]) => {
    const first = list[0]!;
    const kind = (first.kind as string).toLowerCase();
    return {
      userId,
      type: "ARTIST_DROP",
      title: list.length === 1 ? `🆕 ${first.artistName} dropped a new ${kind}` : `🆕 ${first.artistName} and ${list.length - 1} more dropped new music`,
      body: list.length === 1 ? `"${first.title}" is out now.` : list.slice(0, 3).map((r) => `${r.title} by ${r.artistName}`).join(" · "),
      battleId: null,
      link: "/drops",
    };
  });
  await createNotifications(db, push, items);
  return items.length;
}

// ── Reading ────────────────────────────────────────────────────────────────

async function latestDropDay(db: Executor): Promise<string | null> {
  const [row] = await db
    .select({ day: sql<string>`max(${schema.release.dropDay})` })
    .from(schema.release)
    .where(eq(schema.release.status, "LIVE"));
  return row?.day ?? null;
}

/** Wins and games per release from this-or-that matchups (all time). */
export async function verdictStats(db: Executor, ids: string[], since?: Date, until?: Date): Promise<Map<string, { wins: number; games: number }>> {
  const out = new Map<string, { wins: number; games: number }>();
  if (!ids.length) return out;
  const d = schema.releaseDuel;
  const conds = [or(inArray(d.aId, ids), inArray(d.bId, ids))];
  if (since) conds.push(gte(d.createdAt, since));
  if (until) conds.push(lt(d.createdAt, until));
  const rows = await db.select({ a: d.aId, b: d.bId, w: d.winnerId }).from(d).where(and(...conds));
  const want = new Set(ids);
  for (const r of rows) {
    for (const id of [r.a, r.b]) {
      if (!want.has(id)) continue;
      const v = out.get(id) ?? { wins: 0, games: 0 };
      v.games++;
      if (r.w === id) v.wins++;
      out.set(id, v);
    }
  }
  return out;
}

export async function views(db: Executor, viewer: UserRow | null, rows: ReleaseRow[]): Promise<ReleaseView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [mine, follows, submitters, openWars, verdicts] = await Promise.all([
    viewer
      ? db
          .select({ id: schema.releaseFire.releaseId })
          .from(schema.releaseFire)
          .where(and(eq(schema.releaseFire.userId, viewer.id), inArray(schema.releaseFire.releaseId, ids)))
      : Promise.resolve([]),
    viewer ? db.select({ name: schema.artistFollow.name }).from(schema.artistFollow).where(eq(schema.artistFollow.userId, viewer.id)) : Promise.resolve([]),
    (() => {
      const sub = [...new Set(rows.flatMap((r) => (r.submittedById ? [r.submittedById] : [])))];
      return sub.length ? db.select({ id: schema.user.id, handle: schema.user.handle, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, sub)) : Promise.resolve([]);
    })(),
    (() => {
      const w = [...new Set(rows.flatMap((r) => (r.warId ? [r.warId] : [])))];
      return w.length ? db.select({ id: schema.war.id }).from(schema.war).where(and(inArray(schema.war.id, w), eq(schema.war.status, "OPEN"))) : Promise.resolve([]);
    })(),
    verdictStats(db, ids),
  ]);
  const followed = new Set(follows.map((f) => norm(f.name)));
  const open = new Set(openWars.map((w) => w.id));
  return rows.map((r) => {
    const by = r.submittedById ? submitters.find((s) => s.id === r.submittedById) : undefined;
    return {
      id: r.id,
      kind: r.kind as ReleaseKind,
      title: r.title,
      artistName: r.artistName,
      artworkUrl: r.artworkUrl,
      externalUrl: r.externalUrl,
      host: r.provider === "SUBMISSION" ? (r.externalUrl ? mixtapeHost(r.externalUrl) : null) : r.provider === "APPLE_MUSIC" ? "Apple Music" : null,
      releaseDate: r.releaseDate,
      genres: r.genres,
      dropDay: r.dropDay,
      ref: r.provider === "SUBMISSION" ? null : `${r.provider}:${r.externalId}`,
      fired: mine.some((m) => m.id === r.id),
      following: followed.has(norm(r.artistName)),
      warId: r.warId && open.has(r.warId) ? r.warId : null,
      submittedBy: by?.handle ? { handle: by.handle, displayName: by.name } : null,
      status: r.status as ReleaseView["status"],
      verdict: (() => {
        const v = verdicts.get(r.id) ?? { wins: 0, games: 0 };
        return { score: v.games >= VERDICT.minGames ? verdictScore(v.wins, v.games) : null, games: v.games };
      })(),
    };
  });
}

const KINDS = new Set(["SINGLE", "EP", "ALBUM", "MIXTAPE"]);
const PAGE = 30;

/** ?range=today|week|following &kind=SINGLE|EP|ALBUM|MIXTAPE &cursor=<offset> */
export async function listDrops(deps: BattleDeps, viewer: UserRow | null, sp: URLSearchParams): Promise<DropsResponse> {
  const latest = (await latestDropDay(deps.db)) ?? utcDay(new Date());
  const range = sp.get("range") === "week" ? "week" : sp.get("range") === "following" ? "following" : "today";
  const kind = sp.get("kind");
  const offset = Math.max(0, Number.parseInt(sp.get("cursor") ?? "0", 10) || 0);
  const r = schema.release;
  const conds = [eq(r.status, "LIVE")];
  if (range === "today") conds.push(eq(r.dropDay, latest));
  else conds.push(gte(r.dropDay, shiftDay(latest, range === "following" ? -29 : -6)));
  if (kind && KINDS.has(kind)) conds.push(eq(r.kind, kind));
  if (range === "following") {
    if (!viewer) return { day: latest, items: [], nextCursor: null };
    const names = (await deps.db.select({ name: schema.artistFollow.name }).from(schema.artistFollow).where(eq(schema.artistFollow.userId, viewer.id))).map((x) => norm(x.name));
    if (!names.length) return { day: latest, items: [], nextCursor: null };
    conds.push(inArray(sql`lower(${r.artistName})`, names));
  }
  const rows = await deps.db
    .select()
    .from(r)
    .where(and(...conds))
    .orderBy(desc(r.dropDay), asc(r.rank), desc(r.createdAt))
    .limit(PAGE + 1)
    .offset(offset);
  const items = await views(deps.db, viewer, rows.slice(0, PAGE));
  return { day: latest, items, nextCursor: rows.length > PAGE ? String(offset + PAGE) : null };
}

/** 🔥 on or off. Counts for the VYBZ streak and pays a little XP a few times a day. */
export async function fireRelease(deps: BattleDeps, viewer: UserRow | null, id: string, body: unknown): Promise<ReleaseView> {
  const user = requireUser(viewer);
  const on = (body as { on?: unknown } | null)?.on !== false;
  const [row] = await deps.db.select().from(schema.release).where(and(eq(schema.release.id, id), eq(schema.release.status, "LIVE")));
  if (!row) throw new ServiceError(404, "NOT_FOUND");
  if (on) {
    const [fresh] = await deps.db.insert(schema.releaseFire).values({ releaseId: id, userId: user.id }).onConflictDoNothing().returning();
    if (fresh && !(await systemIds(deps.db, [user.id])).size) {
      const l = schema.ledgerEntry;
      const [{ n }] = (await deps.db
        .select({ n: sql<number>`count(*)::int` })
        .from(l)
        .where(and(eq(l.userId, user.id), eq(l.reason, "DROP_FIRE"), gte(l.createdAt, new Date(Date.now() - 86_400_000))))) as [{ n: number }];
      if (n < DROPS.fireXpPerDay) await grant(deps.db, user.id, "DROP_FIRE", id, { xp: DROPS.fireXp, coins: 0 });
      await recordActivity(deps.db, user.id);
    }
  } else {
    await deps.db.delete(schema.releaseFire).where(and(eq(schema.releaseFire.releaseId, id), eq(schema.releaseFire.userId, user.id)));
  }
  return (await views(deps.db, user, [row]))[0]!;
}

// ── Today ──────────────────────────────────────────────────────────────────

/** Home's card: today's drops, whether today's trivia is done, the VYBZ streak. Stores the time zone if we didn't have one. */
export async function todayFor(deps: BattleDeps, viewer: UserRow | null, tzIn: unknown, at = new Date()): Promise<TodayView> {
  const user = requireUser(viewer);
  const given = validTimeZone(tzIn);
  await deps.db.insert(schema.userProgress).values({ userId: user.id, timeZone: given }).onConflictDoNothing();
  if (given) {
    await deps.db
      .update(schema.userProgress)
      .set({ timeZone: given })
      .where(and(eq(schema.userProgress.userId, user.id), sql`${schema.userProgress.timeZone} is null`));
  }
  const [prog] = await deps.db.select({ tz: schema.userProgress.timeZone }).from(schema.userProgress).where(eq(schema.userProgress.userId, user.id));
  const tz = prog?.tz ?? given ?? "UTC";
  const day = localDay(at, tz);
  const latest = await latestDropDay(deps.db);
  const r = schema.release;
  const [counts, top, trivia, streak] = await Promise.all([
    latest
      ? deps.db
          .select({ today: sql<number>`count(*) filter (where ${r.dropDay} = ${latest})::int`, week: sql<number>`count(*)::int` })
          .from(r)
          .where(and(eq(r.status, "LIVE"), gte(r.dropDay, shiftDay(latest, -6))))
      : Promise.resolve([{ today: 0, week: 0 }]),
    latest
      ? deps.db
          .select()
          .from(r)
          .where(and(eq(r.status, "LIVE"), eq(r.dropDay, latest)))
          .orderBy(asc(r.rank))
          .limit(3)
      : Promise.resolve([]),
    deps.db
      .select({ id: schema.triviaPlay.id })
      .from(schema.triviaPlay)
      .innerJoin(schema.triviaSet, eq(schema.triviaSet.id, schema.triviaPlay.setId))
      .where(and(eq(schema.triviaPlay.userId, user.id), eq(schema.triviaSet.mode, "DAILY"), eq(schema.triviaSet.day, day), isNotNull(schema.triviaPlay.finishedAt)))
      .limit(1),
    vybzStreak(deps.db, user.id, at),
  ]);
  return {
    day,
    drops: { today: counts[0]?.today ?? 0, week: counts[0]?.week ?? 0, top: await views(deps.db, user, top) },
    trivia: { done: trivia.length > 0 },
    streak,
  };
}

// ── Following artists ──────────────────────────────────────────────────────

export async function searchArtists(deps: BattleDeps, viewer: UserRow | null, q: string): Promise<{ items: ArtistFollowHit[] }> {
  const user = requireUser(viewer);
  const p = browseProvider(deps);
  if (!p) throw new ServiceError(503, "ARTISTS_UNAVAILABLE", "Artist search isn't available right now.");
  const term = q.trim().slice(0, 100);
  if (!term) return { items: [] };
  const [found, mine] = await Promise.all([
    p.searchArtists(term, { storefront: deps.catalog.storefront, limit: 10 }),
    deps.db.select({ externalId: schema.artistFollow.externalId }).from(schema.artistFollow).where(and(eq(schema.artistFollow.userId, user.id), eq(schema.artistFollow.provider, p.kind))),
  ]);
  return {
    items: found.map((a) => ({ provider: a.provider, externalId: a.externalId, name: a.name, artworkUrl: a.artwork?.url ?? null, following: mine.some((m) => m.externalId === a.externalId) })),
  };
}

export async function myArtists(deps: BattleDeps, viewer: UserRow | null): Promise<{ items: FollowedArtist[] }> {
  const user = requireUser(viewer);
  const rows = await deps.db.select().from(schema.artistFollow).where(eq(schema.artistFollow.userId, user.id)).orderBy(asc(schema.artistFollow.name));
  return { items: rows.map((r) => ({ provider: r.provider, externalId: r.externalId, name: r.name, artworkUrl: r.artworkUrl, createdAt: r.createdAt.toISOString() })) };
}

/**
 * Follow an artist: `{ provider, externalId, name, artworkUrl? }` from the
 * artist search, or `{ releaseId }` to follow a drop's artist (looked up by
 * name with the provider's artist search).
 */
export async function followArtist(deps: BattleDeps, viewer: UserRow | null, body: unknown): Promise<{ items: FollowedArtist[] }> {
  const user = requireUser(viewer);
  const p = browseProvider(deps);
  if (!p) throw new ServiceError(503, "ARTISTS_UNAVAILABLE", "Artist search isn't available right now.");
  const b = (body ?? {}) as { provider?: unknown; externalId?: unknown; name?: unknown; artworkUrl?: unknown; releaseId?: unknown };
  let artist: { externalId: string; name: string; artworkUrl: string | null };
  if (typeof b.releaseId === "string") {
    const [rel] = await deps.db.select().from(schema.release).where(eq(schema.release.id, b.releaseId));
    if (!rel) throw new ServiceError(404, "NOT_FOUND");
    if (rel.provider === "SUBMISSION") {
      // Mixtape artists usually aren't in the catalog; follow by name.
      artist = { externalId: `name:${norm(rel.artistName)}`, name: rel.artistName, artworkUrl: null };
    } else {
      const hits = await p.searchArtists(rel.artistName, { storefront: deps.catalog.storefront, limit: 5 }).catch(() => []);
      const hit = hits.find((h) => norm(h.name) === norm(rel.artistName)) ?? hits[0];
      artist = hit ? { externalId: hit.externalId, name: hit.name, artworkUrl: hit.artwork?.url ?? null } : { externalId: `name:${norm(rel.artistName)}`, name: rel.artistName, artworkUrl: null };
    }
  } else {
    if (b.provider !== p.kind || typeof b.externalId !== "string" || typeof b.name !== "string" || !b.externalId || !b.name.trim()) {
      throw new ServiceError(400, "INVALID_ARTIST", "Pick an artist from the search.");
    }
    artist = { externalId: b.externalId.slice(0, 100), name: b.name.trim().slice(0, 200), artworkUrl: typeof b.artworkUrl === "string" && b.artworkUrl.startsWith("https://") ? b.artworkUrl.slice(0, 500) : null };
  }
  const [{ n }] = (await deps.db.select({ n: sql<number>`count(*)::int` }).from(schema.artistFollow).where(eq(schema.artistFollow.userId, user.id))) as [{ n: number }];
  if (n >= DROPS.maxFollows) throw new ServiceError(409, "TOO_MANY_ARTISTS", `You can follow up to ${DROPS.maxFollows} artists.`);
  await deps.db
    .insert(schema.artistFollow)
    .values({ userId: user.id, provider: p.kind, externalId: artist.externalId, name: artist.name, artworkUrl: artist.artworkUrl })
    .onConflictDoNothing();
  return myArtists(deps, user);
}

/** Unfollow by artist id, or by name (for a drop's artist). */
export async function unfollowArtist(deps: BattleDeps, viewer: UserRow | null, body: unknown): Promise<{ items: FollowedArtist[] }> {
  const user = requireUser(viewer);
  const b = (body ?? {}) as { externalId?: unknown; name?: unknown };
  const f = schema.artistFollow;
  if (typeof b.externalId === "string") await deps.db.delete(f).where(and(eq(f.userId, user.id), eq(f.externalId, b.externalId)));
  else if (typeof b.name === "string") await deps.db.delete(f).where(and(eq(f.userId, user.id), sql`lower(${f.name}) = ${norm(b.name)}`));
  else throw new ServiceError(400, "INVALID_ARTIST");
  return myArtists(deps, user);
}

// ── Mixtapes ───────────────────────────────────────────────────────────────

/** A link's identity: host and path (and YouTube's ?v=), lowercased, so the same tape can't be submitted twice. */
export function mixtapeKey(url: string): string {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const v = host.endsWith("youtube.com") ? u.searchParams.get("v") ?? u.searchParams.get("list") : null;
  return `${host}${u.pathname.replace(/\/+$/, "").toLowerCase()}${v ? `?v=${v}` : ""}`;
}

/** `{ title, artistName, url, note? }`. Goes live once a moderator approves it (right away for staff). */
export async function submitMixtape(deps: BattleDeps, viewer: UserRow | null, body: unknown, now = new Date()): Promise<ReleaseView> {
  const user = requireUser(viewer);
  const b = (body ?? {}) as { title?: unknown; artistName?: unknown; url?: unknown; note?: unknown };
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const artistName = typeof b.artistName === "string" ? b.artistName.trim() : "";
  const url = typeof b.url === "string" ? b.url.trim() : "";
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";
  if (title.length < 1 || title.length > 120 || artistName.length < 1 || artistName.length > 120) {
    throw new ServiceError(400, "INVALID_MIXTAPE", "Add the mixtape's title and artist.");
  }
  if (!mixtapeHost(url)) throw new ServiceError(400, "UNSUPPORTED_LINK", "Use an https link from SoundCloud, Audiomack, YouTube, Bandcamp, Apple Music, Spotify or TIDAL.");
  const staff = isStaff(user);
  if (!staff) {
    const [{ n }] = (await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.release)
      .where(and(eq(schema.release.submittedById, user.id), gte(schema.release.createdAt, new Date(now.getTime() - 86_400_000))))) as [{ n: number }];
    if (n >= DROPS.submissionsPerDay) throw new ServiceError(429, "SLOW_DOWN", `You can submit ${DROPS.submissionsPerDay} mixtapes a day.`);
  }
  const [row] = await deps.db
    .insert(schema.release)
    .values({
      id: newId(),
      provider: "SUBMISSION",
      externalId: mixtapeKey(url),
      kind: "MIXTAPE",
      title,
      artistName,
      externalUrl: url,
      source: "SUBMISSION",
      status: staff ? "LIVE" : "PENDING",
      dropDay: utcDay(now),
      rank: 500,
      submittedById: user.id,
      note: note || null,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new ServiceError(409, "MIXTAPE_EXISTS", "That mixtape has already been submitted.");
  if (!staff) {
    const mods = await deps.db.select({ id: schema.user.id }).from(schema.user).where(and(or(eq(schema.user.role, "MODERATOR"), eq(schema.user.role, "ADMIN")), eq(schema.user.status, "ACTIVE")));
    await createNotifications(
      deps.db,
      null,
      mods.map((m) => ({ userId: m.id, type: "ARTIST_DROP" as const, title: "📼 New mixtape to review", body: `${title} by ${artistName}`, battleId: null, link: "/mod/mixtapes" })),
    );
  }
  return (await views(deps.db, user, [row]))[0]!;
}

export async function pendingMixtapes(deps: BattleDeps, viewer: UserRow | null): Promise<{ items: (ReleaseView & { note: string | null })[] }> {
  requireStaff(viewer);
  const rows = await deps.db
    .select()
    .from(schema.release)
    .where(and(eq(schema.release.provider, "SUBMISSION"), eq(schema.release.status, "PENDING")))
    .orderBy(asc(schema.release.createdAt))
    .limit(100);
  const v = await views(deps.db, viewer, rows);
  return { items: v.map((x, i) => ({ ...x, note: rows[i]!.note })) };
}

/** `{ action: "approve" | "reject" }`. Approved tapes become today's drops. */
export async function reviewMixtape(deps: BattleDeps, viewer: UserRow | null, id: string, body: unknown, now = new Date()): Promise<{ ok: true }> {
  requireStaff(viewer);
  const action = (body as { action?: unknown } | null)?.action;
  if (action !== "approve" && action !== "reject") throw new ServiceError(400, "INVALID_ACTION");
  const [row] = await deps.db
    .update(schema.release)
    .set(action === "approve" ? { status: "LIVE", dropDay: utcDay(now) } : { status: "REJECTED" })
    .where(and(eq(schema.release.id, id), eq(schema.release.provider, "SUBMISSION"), eq(schema.release.status, "PENDING")))
    .returning();
  if (!row) throw new ServiceError(404, "NOT_FOUND");
  if (row.submittedById) {
    await createNotifications(deps.db, deps.push, [
      {
        userId: row.submittedById,
        type: "ARTIST_DROP",
        title: action === "approve" ? "📼 Your mixtape is live" : "Your mixtape wasn't approved",
        body: action === "approve" ? `"${row.title}" is in today's drops.` : `"${row.title}" didn't make it into Daily Drops.`,
        battleId: null,
        link: action === "approve" ? "/drops" : null,
      },
    ]);
  }
  if (action === "approve") await notifyFollowers(deps.db, deps.push, [row]);
  return { ok: true };
}

// ── The daily notification ─────────────────────────────────────────────────

export const DIGEST_FROM_HOUR = 12;
export const DIGEST_UNTIL_HOUR = 14;

function localHour(at: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at));
}

/**
 * One push a day around lunchtime, in the person's time zone, for people who
 * have the app (a push token) and were active in the last two weeks: today's
 * drops, today's trivia, and their VYBZ streak. At most one a day.
 */
export async function sendDailyDigest(db: Executor, push: PushSender | null | undefined, at = new Date()): Promise<number> {
  const since = shiftDay(utcDay(at), -14);
  const candidates = await db
    .selectDistinct({ userId: schema.pushToken.userId, tz: schema.userProgress.timeZone })
    .from(schema.pushToken)
    .innerJoin(schema.userProgress, eq(schema.userProgress.userId, schema.pushToken.userId))
    .innerJoin(schema.user, eq(schema.user.id, schema.pushToken.userId))
    .where(
      and(
        isNotNull(schema.userProgress.timeZone),
        eq(schema.user.status, "ACTIVE"),
        eq(schema.user.isSystem, false),
        sql`exists (select 1 from ${schema.activityDay} a where a.user_id = ${schema.pushToken.userId} and a.day >= ${since} and not a.frozen)`,
      ),
    );
  const latest = await latestDropDay(db);
  const [counts] = latest
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.release)
        .where(and(eq(schema.release.status, "LIVE"), eq(schema.release.dropDay, latest)))
    : [{ n: 0 }];
  const freshDrops = latest && latest >= shiftDay(utcDay(at), -1) ? (counts?.n ?? 0) : 0;
  let sent = 0;
  for (const c of candidates) {
    const tz = c.tz!;
    const hour = localHour(at, tz);
    if (hour < DIGEST_FROM_HOUR || hour >= DIGEST_UNTIL_HOUR) continue;
    const today = localDay(at, tz);
    const [fresh] = await db.insert(schema.reminderSent).values({ userId: c.userId, kind: "DIGEST", day: today }).onConflictDoNothing().returning();
    if (!fresh) continue;
    const streak = await vybzStreak(db, c.userId, at);
    const parts = [
      freshDrops > 0 ? `${freshDrops} new drop${freshDrops === 1 ? "" : "s"} today.` : "New music this week.",
      "Today's trivia is ready.",
      streak.current > 0 && !streak.activeToday ? `Keep your ${streak.current}-day streak alive.` : null,
    ].filter(Boolean);
    await createNotifications(db, push, [
      { userId: c.userId, type: "DAILY_DIGEST", title: streak.current > 1 ? `🔥 Day ${streak.current + (streak.activeToday ? 0 : 1)} on VYBZ` : "🎧 Today on VYBZ", body: parts.join(" "), battleId: null, link: "/drops" },
    ]);
    sent++;
  }
  return sent;
}
