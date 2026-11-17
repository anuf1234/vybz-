import { GENRE_KEYS, type LeaderboardEntry, type LeaderboardMetric, type LeaderboardPeriod, type LeaderboardResponse, type LeaderboardScope } from "@vybz/core";
import { type SQL, and, eq, gte, inArray, or, schema, sql } from "@vybz/db";
import { type BattleDeps, ServiceError, type UserRow, usersById } from "./battles/service";

/**
 * Leaderboards: global, among people you follow, or for one genre; over the
 * last 7 days, 30 days or all time; by battles won or rounds won. Built from
 * finished battles, so they're always consistent with results.
 */

const PERIOD_DAYS: Record<Exclude<LeaderboardPeriod, "all">, number> = { week: 7, month: 30 };
const LIMIT = 50;

export interface LeaderboardQuery {
  scope: LeaderboardScope;
  genre?: string | null;
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
}

export function parseLeaderboardQuery(sp: URLSearchParams): LeaderboardQuery {
  const scope = (sp.get("scope") ?? "global") as LeaderboardScope;
  const period = (sp.get("period") ?? "all") as LeaderboardPeriod;
  const metric = (sp.get("metric") ?? "wins") as LeaderboardMetric;
  const genre = sp.get("genre");
  if (!["global", "following", "genre"].includes(scope) || !["week", "month", "all"].includes(period) || !["wins", "rounds", "xp"].includes(metric)) {
    throw new ServiceError(400, "INVALID_QUERY");
  }
  if (scope === "genre" && (!genre || !(GENRE_KEYS as string[]).includes(genre))) throw new ServiceError(400, "INVALID_QUERY", "Pick a genre.");
  return { scope, genre: scope === "genre" ? genre : null, period, metric };
}

type Row = { userId: string; wins: number; losses: number; draws: number; roundsWon: number; battles: number; xp: number };

/** Per-user totals for the query, best first. */
async function totals(deps: BattleDeps, viewer: UserRow | null, q: LeaderboardQuery): Promise<Row[]> {
  const p = schema.battleParticipant;
  const b = schema.battle;
  const since = q.period === "all" ? null : new Date(Date.now() - PERIOD_DAYS[q.period] * 86_400_000);
  const conds: SQL[] = [eq(b.status, "COMPLETE"), eq(schema.user.status, "ACTIVE")];
  if (since) conds.push(gte(b.endedAt, since));
  if (q.scope === "genre") conds.push(sql`(${b.rules} -> 'constraints' -> 'genres') ? ${q.genre}`);
  if (q.scope === "following") {
    if (!viewer) throw new ServiceError(401, "SIGN_IN_REQUIRED");
    const followed = deps.db.select({ id: schema.follow.followeeId }).from(schema.follow).where(eq(schema.follow.followerId, viewer.id));
    conds.push(or(eq(p.userId, viewer.id), inArray(p.userId, followed))!);
  }
  const rows = await deps.db
    .select({
      userId: p.userId,
      wins: sql<number>`count(*) filter (where ${b.winnerParticipantId} = ${p.id})::int`,
      draws: sql<number>`count(*) filter (where ${b.winnerParticipantId} is null)::int`,
      losses: sql<number>`count(*) filter (where ${b.winnerParticipantId} is not null and ${b.winnerParticipantId} <> ${p.id})::int`,
      roundsWon: sql<number>`coalesce(sum(${p.roundsWon}), 0)::int`,
      battles: sql<number>`count(*)::int`,
    })
    .from(p)
    .innerJoin(b, eq(b.id, p.battleId))
    .innerJoin(schema.user, eq(schema.user.id, p.userId))
    .where(and(...conds))
    .groupBy(p.userId);
  const out: Row[] = rows.map((r) => ({ ...r, xp: 0 }));
  const key = (r: Row) => (q.metric === "rounds" ? [r.roundsWon, r.wins, -r.losses] : q.metric === "xp" ? [r.xp, r.wins, r.roundsWon] : [r.wins, r.roundsWon, -r.losses]);
  return out.sort((x, y) => {
    const a = key(x);
    const c = key(y);
    for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) return c[i]! - a[i]!;
    return x.userId < y.userId ? -1 : 1;
  });
}

export async function leaderboard(deps: BattleDeps, viewer: UserRow | null, q: LeaderboardQuery): Promise<LeaderboardResponse> {
  const rows = await totals(deps, viewer, q);
  // Ties share a rank (1, 2, 2, 4).
  const value = (r: Row) => (q.metric === "rounds" ? r.roundsWon : q.metric === "xp" ? r.xp : r.wins);
  const ranks: number[] = [];
  rows.forEach((r, i) => (ranks[i] = i > 0 && value(r) === value(rows[i - 1]!) ? ranks[i - 1]! : i + 1));
  const myIndex = viewer ? rows.findIndex((r) => r.userId === viewer.id) : -1;
  const shown = rows.slice(0, LIMIT);
  const ids = [...new Set([...shown.map((r) => r.userId), ...(myIndex >= 0 ? [viewer!.id] : [])])];
  const [users, levels] = await Promise.all([usersById(deps.db, ids), levelsOf(deps, ids)]);
  const entry = (r: Row, i: number): LeaderboardEntry => ({
    rank: ranks[i]!,
    user: users.get(r.userId) ?? { id: r.userId, handle: "unknown", displayName: "Unknown", image: null },
    value: value(r),
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    roundsWon: r.roundsWon,
    battles: r.battles,
    level: levels.get(r.userId) ?? 1,
  });
  return {
    scope: q.scope,
    genre: q.genre ?? null,
    period: q.period,
    metric: q.metric,
    items: shown.map(entry),
    me: myIndex >= 0 ? entry(rows[myIndex]!, myIndex) : null,
  };
}

async function levelsOf(deps: BattleDeps, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await deps.db.select({ id: schema.userProgress.userId, level: schema.userProgress.level }).from(schema.userProgress).where(inArray(schema.userProgress.userId, ids));
  return new Map(rows.map((r) => [r.id, r.level]));
}
