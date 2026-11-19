import { type ChartResponse, type ChartRow, VERDICT, type VerdictPair, isoWeek, verdictScore, weekStart } from "@vybz/core";
import { type Executor, and, desc, eq, gte, inArray, lt, newId, schema, sql } from "@vybz/db";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { botUser } from "./bot";
import { type ReleaseRow, utcDayOf, verdictStats, views } from "./drops";
import { grant, shiftDay, systemIds } from "./progression";
import { recordActivity } from "./vybz-streak";
import { createSpotifyPlaylist, spotifyConfigured } from "./spotify";

/**
 * Fan Verdict: quick "this or that" picks between two recent drops of the
 * same kind (singles against singles, projects against projects). A
 * release's verdict is its smoothed share of matchups won. The weekly VYBZ
 * Chart ranks the releases with enough matchups that week; Monday freezes
 * last week's chart and posts it from the VYBZ account.
 */

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  return user;
}

const group = (k: string) => (k === "SINGLE" ? "S" : "P");
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

async function pool(db: Executor, now: Date): Promise<ReleaseRow[]> {
  return db
    .select()
    .from(schema.release)
    .where(and(eq(schema.release.status, "LIVE"), gte(schema.release.dropDay, shiftDay(utcDayOf(now), -VERDICT.poolDays))))
    .orderBy(desc(schema.release.dropDay), schema.release.rank)
    .limit(300);
}

/** The next pair for this person: same kind, not judged by them before, favouring drops with few matchups. Null when they've done them all. */
export async function nextPair(deps: BattleDeps, viewer: UserRow | null, now = new Date()): Promise<VerdictPair | null> {
  const user = requireUser(viewer);
  const rows = await pool(deps.db, now);
  if (rows.length < 2) return null;
  const d = schema.releaseDuel;
  const [stats, mine, today] = await Promise.all([
    verdictStats(
      deps.db,
      rows.map((r) => r.id),
    ),
    deps.db.select({ a: d.aId, b: d.bId }).from(d).where(eq(d.userId, user.id)),
    deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(d)
      .where(and(eq(d.userId, user.id), gte(d.createdAt, new Date(now.getTime() - 86_400_000)))),
  ]);
  const judged = new Set(mine.map((m) => pairKey(m.a, m.b)));
  const games = (id: string) => stats.get(id)?.games ?? 0;
  // Fewest matchups first, shuffled within ties so everyone doesn't get the same pair.
  const order = [...rows].map((r) => ({ r, k: games(r.id) + Math.random() })).sort((x, y) => x.k - y.k).map((x) => x.r);
  for (const a of order.slice(0, 40)) {
    const b = order.find((x) => x.id !== a.id && group(x.kind) === group(a.kind) && !judged.has(pairKey(a.id, x.id)));
    if (b) {
      const [va, vb] = await views(deps.db, user, Math.random() < 0.5 ? [a, b] : [b, a]);
      return { a: va!, b: vb!, judgedToday: today[0]?.n ?? 0 };
    }
  }
  return null;
}

/** `{ a, b, winner }`. Counts for the VYBZ streak; a little XP for the first few a day. Returns the next pair. */
export async function judgePair(deps: BattleDeps, viewer: UserRow | null, body: unknown, now = new Date()): Promise<{ next: VerdictPair | null }> {
  const user = requireUser(viewer);
  const b = (body ?? {}) as { a?: unknown; b?: unknown; winner?: unknown };
  if (typeof b.a !== "string" || typeof b.b !== "string" || b.a === b.b || (b.winner !== b.a && b.winner !== b.b)) throw new ServiceError(400, "INVALID_REQUEST");
  const both = await deps.db
    .select({ id: schema.release.id, kind: schema.release.kind })
    .from(schema.release)
    .where(and(inArray(schema.release.id, [b.a, b.b]), eq(schema.release.status, "LIVE")));
  if (both.length !== 2 || group(both[0]!.kind) !== group(both[1]!.kind)) throw new ServiceError(400, "INVALID_PAIR");
  const [aId, bId] = b.a < b.b ? [b.a, b.b] : [b.b, b.a];
  const [fresh] = await deps.db.insert(schema.releaseDuel).values({ userId: user.id, aId, bId, winnerId: b.winner, createdAt: now }).onConflictDoNothing().returning();
  if (fresh && !(await systemIds(deps.db, [user.id])).size) {
    const l = schema.ledgerEntry;
    const [{ n }] = (await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(l)
      .where(and(eq(l.userId, user.id), eq(l.reason, "VERDICT"), gte(l.createdAt, new Date(now.getTime() - 86_400_000))))) as [{ n: number }];
    if (n < VERDICT.xpPerDay) await grant(deps.db, user.id, "VERDICT", pairKey(aId, bId), { xp: VERDICT.xp, coins: 0 });
    await recordActivity(deps.db, user.id, now);
  }
  return { next: await nextPair(deps, user, now) };
}

// ── The weekly chart ───────────────────────────────────────────────────────

interface FrozenRow {
  releaseId: string;
  rank: number;
  wins: number;
  games: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekLabel(week: string): string {
  const s = weekStart(week);
  const e = new Date(s.getTime() + 6 * 86_400_000);
  const m = (d: Date) => MONTHS[d.getUTCMonth()]!;
  return s.getUTCMonth() === e.getUTCMonth() ? `${m(s)} ${s.getUTCDate()} – ${e.getUTCDate()}` : `${m(s)} ${s.getUTCDate()} – ${m(e)} ${e.getUTCDate()}`;
}

const shiftWeek = (week: string, by: number) => isoWeek(new Date(weekStart(week).getTime() + by * 7 * 86_400_000 + 3 * 86_400_000));

/** Ranks a week from its matchups. */
async function computeWeek(db: Executor, week: string): Promise<FrozenRow[]> {
  const start = weekStart(week);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const d = schema.releaseDuel;
  const duels = await db
    .select({ a: d.aId, b: d.bId, w: d.winnerId })
    .from(d)
    .where(and(gte(d.createdAt, start), lt(d.createdAt, end)));
  const stats = new Map<string, { wins: number; games: number }>();
  for (const x of duels) {
    for (const id of [x.a, x.b]) {
      const v = stats.get(id) ?? { wins: 0, games: 0 };
      v.games++;
      if (x.w === id) v.wins++;
      stats.set(id, v);
    }
  }
  const ranked = [...stats.entries()]
    .filter(([, v]) => v.games >= VERDICT.minGames)
    .sort(([, x], [, y]) => verdictScore(y.wins, y.games) - verdictScore(x.wins, x.games) || y.games - x.games)
    .slice(0, VERDICT.chartSize);
  return ranked.map(([releaseId, v], i) => ({ releaseId, rank: i + 1, wins: v.wins, games: v.games }));
}

async function rowsFor(db: Executor, week: string, now: Date): Promise<{ rows: FrozenRow[]; final: boolean }> {
  const [frozen] = await db.select().from(schema.chartWeek).where(eq(schema.chartWeek.week, week));
  if (frozen) return { rows: frozen.rows as FrozenRow[], final: true };
  const rows = await computeWeek(db, week);
  return { rows, final: week < isoWeek(now) };
}

/** ?week=2026-W47 (default: this week). */
export async function chart(deps: BattleDeps, viewer: UserRow | null, weekIn: string | null, now = new Date()): Promise<ChartResponse> {
  const current = isoWeek(now);
  const week = weekIn && /^\d{4}-W\d{2}$/.test(weekIn) && weekIn <= current ? weekIn : current;
  const [{ rows, final }, prev] = await Promise.all([rowsFor(deps.db, week, now), rowsFor(deps.db, shiftWeek(week, -1), now)]);
  const releases = rows.length ? await deps.db.select().from(schema.release).where(inArray(schema.release.id, rows.map((r) => r.releaseId))) : [];
  const live = releases.filter((r) => r.status === "LIVE");
  const v = await views(deps.db, viewer, live);
  const lastRank = new Map(prev.rows.map((r) => [r.releaseId, r.rank]));
  const out: ChartRow[] = rows.flatMap((r) => {
    const release = v.find((x) => x.id === r.releaseId);
    return release ? [{ rank: r.rank, lastRank: lastRank.get(r.releaseId) ?? null, release, score: verdictScore(r.wins, r.games), wins: r.wins, games: r.games }] : [];
  });
  return { week, label: weekLabel(week), final, rows: out, prevWeek: shiftWeek(week, -1), nextWeek: week < current ? shiftWeek(week, 1) : null };
}

/** Monday: freeze last week's chart and post its top 10 from the VYBZ account. Once per week. */
export async function publishWeeklyChart(deps: BattleDeps, now = new Date()): Promise<{ week: string; posted: boolean } | null> {
  const last = shiftWeek(isoWeek(now), -1);
  const [exists] = await deps.db.select({ week: schema.chartWeek.week }).from(schema.chartWeek).where(eq(schema.chartWeek.week, last));
  if (exists) return null;
  const rows = await computeWeek(deps.db, last);
  const [claimed] = await deps.db.insert(schema.chartWeek).values({ week: last, rows }).onConflictDoNothing().returning();
  if (!claimed || !rows.length) return claimed ? { week: last, posted: false } : null;
  const releases = await deps.db.select().from(schema.release).where(inArray(schema.release.id, rows.slice(0, 10).map((r) => r.releaseId)));
  const lines = rows.slice(0, 10).flatMap((r) => {
    const rel = releases.find((x) => x.id === r.releaseId);
    return rel ? [`${r.rank}. ${rel.title} by ${rel.artistName} (${verdictScore(r.wins, r.games)}%)`] : [];
  });
  try {
    const bot = await botUser(deps);
    const id = newId();
    await deps.db.insert(schema.post).values({ id, authorId: bot.id, body: [`📊 The VYBZ Chart, ${weekLabel(last)}`, "", ...lines, "", "Ranked by fans in This or That. Cast your picks for this week's chart."].join("\n") });
    await deps.db.update(schema.chartWeek).set({ postId: id }).where(eq(schema.chartWeek.week, last));
    return { week: last, posted: true };
  } catch (err) {
    console.error("chart post failed", err);
    return { week: last, posted: false };
  }
}

/** Saves a week's chart as a private playlist on the person's linked Spotify. */
export async function exportChartToSpotify(deps: BattleDeps, viewer: UserRow | null, body: unknown, fetchFn?: typeof fetch): Promise<{ url: string; added: number }> {
  const user = requireUser(viewer);
  if (!spotifyConfigured()) throw new ServiceError(503, "SPOTIFY_UNAVAILABLE", "Saving to Spotify isn't set up yet.");
  const week = typeof (body as { week?: unknown } | null)?.week === "string" ? (body as { week: string }).week : null;
  const c = await chart(deps, user, week);
  if (!c.rows.length) throw new ServiceError(409, "CHART_EMPTY", "Nothing has charted this week yet.");
  const items = c.rows.filter((r) => r.release.kind !== "MIXTAPE").map((r) => ({ title: r.release.title, artistName: r.release.artistName, type: r.release.kind === "SINGLE" ? ("track" as const) : ("album" as const), isrc: null }));
  const out = await createSpotifyPlaylist(deps.db, user.id, `The VYBZ Chart · ${c.label}`, "New music ranked by fans on VYBZ. One song from each charting release.", items, fetchFn);
  if (out === "NOT_LINKED") throw new ServiceError(409, "SPOTIFY_NOT_LINKED", "Connect Spotify first.");
  await deps.db.insert(schema.outboundClick).values({ id: newId(), userId: user.id, viewerKey: `u:${user.id}`, service: "spotify", kind: "playlist", ref: c.week });
  return out;
}
