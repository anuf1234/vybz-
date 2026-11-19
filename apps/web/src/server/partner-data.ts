import { type DropAwardKind, type HeatStats, type ReleaseDayStatsRow, type ReleaseKind, heatScore } from "@vybz/core";
import { type Executor, and, asc, eq, gte, inArray, lt, lte, or, schema, sql } from "@vybz/db";
import { isStaff } from "./battles/access";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { shiftDay } from "./progression";

/**
 * Partner data: per-release totals for each day (fires, This-or-That wins
 * and matchups, verified Apple Music plays, listens by service, heat),
 * snapshotted by the scheduler and exported for staff as CSV or JSON. These
 * are counts of people, never who they are, and they're never shown in the
 * app.
 */

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Recomputes one UTC day's totals for every release with any activity that day. */
export async function snapshotDay(db: Executor, day: string): Promise<number> {
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(`${shiftDay(day, 1)}T00:00:00Z`);
  const d = schema.releaseDuel;
  const o = schema.outboundClick;
  const [fires, wins, matchups, plays, listens] = await Promise.all([
    db
      .select({ id: schema.releaseFire.releaseId, n: sql<number>`count(*)::int` })
      .from(schema.releaseFire)
      .where(and(gte(schema.releaseFire.createdAt, start), lt(schema.releaseFire.createdAt, end)))
      .groupBy(schema.releaseFire.releaseId),
    db
      .select({ id: d.winnerId, n: sql<number>`count(*)::int` })
      .from(d)
      .where(and(gte(d.createdAt, start), lt(d.createdAt, end)))
      .groupBy(d.winnerId),
    db
      .select({ a: d.aId, b: d.bId })
      .from(d)
      .where(and(gte(d.createdAt, start), lt(d.createdAt, end))),
    db
      .select({ id: schema.playEvent.releaseId, n: sql<number>`count(distinct ${schema.playEvent.userId})::int` })
      .from(schema.playEvent)
      .where(eq(schema.playEvent.day, day))
      .groupBy(schema.playEvent.releaseId),
    db
      .select({ id: o.ref, service: o.service, n: sql<number>`count(distinct coalesce(${o.userId}, ${o.viewerKey}))::int` })
      .from(o)
      .where(and(eq(o.kind, "release"), gte(o.createdAt, start), lt(o.createdAt, end)))
      .groupBy(o.ref, o.service),
  ]);
  const rows = new Map<string, { fires: number; wins: number; matchups: number; plays: number; listens: number; listensBy: Record<string, number> }>();
  const get = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { fires: 0, wins: 0, matchups: 0, plays: 0, listens: 0, listensBy: {} }));
    return r;
  };
  for (const f of fires) get(f.id).fires = f.n;
  for (const w of wins) get(w.id).wins = w.n;
  for (const m of matchups) for (const id of [m.a, m.b]) get(id).matchups++;
  for (const p of plays) get(p.id).plays = p.n;
  for (const l of listens) {
    const r = get(l.id);
    r.listensBy[l.service] = l.n;
    // People per service, summed: a person on two services counts on each.
    r.listens += l.n;
  }
  // Outbound refs are only release ids when kind = "release"; drop anything that isn't a known release.
  const ids = [...rows.keys()];
  const known = ids.length ? new Set((await db.select({ id: schema.release.id }).from(schema.release).where(inArray(schema.release.id, ids))).map((r) => r.id)) : new Set<string>();
  let n = 0;
  for (const [id, r] of rows) {
    if (!known.has(id)) continue;
    const values = { day, releaseId: id, ...r, heat: heatScore(r) };
    await db.insert(schema.releaseDayStats).values(values).onConflictDoUpdate({ target: [schema.releaseDayStats.day, schema.releaseDayStats.releaseId], set: values });
    n++;
  }
  return n;
}

/** Scheduler: yesterday (final) and today (so far). */
export async function snapshotRecent(db: Executor, now = new Date()): Promise<number> {
  const today = utcDay(now);
  return (await snapshotDay(db, shiftDay(today, -1))) + (await snapshotDay(db, today));
}

function requireStaff(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!isStaff(user)) throw new ServiceError(403, "FORBIDDEN");
  return user;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote, and neutralize spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

const SERVICES = ["spotify", "apple", "youtube"];

/**
 * Staff: `?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|json` (default the last
 * 30 days, JSON). Today's numbers are refreshed first.
 */
export async function exportReleaseStats(deps: BattleDeps, viewer: UserRow | null, sp: URLSearchParams, now = new Date()): Promise<{ rows: ReleaseDayStatsRow[] } | string> {
  requireStaff(viewer);
  const today = utcDay(now);
  const valid = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const to = valid(sp.get("to")) ?? today;
  const from = valid(sp.get("from")) ?? shiftDay(to, -29);
  if (from > to) throw new ServiceError(400, "INVALID_RANGE");
  if (to >= today) await snapshotDay(deps.db, today);
  const s = schema.releaseDayStats;
  const r = schema.release;
  const data = await deps.db
    .select({ s, r: { title: r.title, artistName: r.artistName, kind: r.kind, provider: r.provider, externalId: r.externalId } })
    .from(s)
    .innerJoin(r, eq(r.id, s.releaseId))
    .where(and(gte(s.day, from), lte(s.day, to)))
    .orderBy(asc(s.day), sql`${s.heat} desc`)
    .limit(50_000);
  const rows: ReleaseDayStatsRow[] = data.map(({ s: x, r: y }) => ({
    day: x.day,
    releaseId: x.releaseId,
    title: y.title,
    artistName: y.artistName,
    kind: y.kind as ReleaseKind,
    provider: y.provider,
    externalId: y.provider === "SUBMISSION" ? "" : y.externalId,
    fires: x.fires,
    wins: x.wins,
    matchups: x.matchups,
    plays: x.plays,
    listens: x.listens,
    listensBy: x.listensBy as Record<string, number>,
    heat: x.heat,
  }));
  if (sp.get("format") !== "csv") return { rows };
  const others = (lb: Record<string, number>) => Object.entries(lb).filter(([k]) => !SERVICES.includes(k)).reduce((a, [, v]) => a + v, 0);
  return toCsv(
    ["day", "release_id", "title", "artist", "type", "catalog", "catalog_id", "heat", "fires", "this_or_that_wins", "this_or_that_matchups", "apple_music_plays", "listens", "listens_spotify", "listens_apple_music", "listens_youtube", "listens_other"],
    rows.map((x) => [x.day, x.releaseId, x.title, x.artistName, x.kind, x.provider, x.externalId, x.heat, x.fires, x.wins, x.matchups, x.plays, x.listens, x.listensBy.spotify ?? 0, x.listensBy.apple ?? 0, x.listensBy.youtube ?? 0, others(x.listensBy)]),
  );
}

/** Staff: every Song of the Day / Week and Album of the Week with the totals that won it. */
export async function exportAwards(deps: BattleDeps, viewer: UserRow | null, sp: URLSearchParams): Promise<{ rows: { award: DropAwardKind; period: string; releaseId: string; title: string; artistName: string; stats: HeatStats }[] } | string> {
  requireStaff(viewer);
  const a = schema.dropAward;
  const r = schema.release;
  const data = await deps.db
    .select({ award: a.award, period: a.period, releaseId: a.releaseId, stats: a.stats, title: r.title, artistName: r.artistName })
    .from(a)
    .innerJoin(r, eq(r.id, a.releaseId))
    .where(or(eq(a.award, "SONG_DAY"), eq(a.award, "SONG_WEEK"), eq(a.award, "ALBUM_WEEK")))
    .orderBy(asc(a.period))
    .limit(10_000);
  const rows = data.map((d) => ({ award: d.award as DropAwardKind, period: d.period, releaseId: d.releaseId, title: d.title, artistName: d.artistName, stats: d.stats as HeatStats }));
  if (sp.get("format") !== "csv") return { rows };
  return toCsv(
    ["award", "period", "release_id", "title", "artist", "heat", "fires", "this_or_that_wins", "apple_music_plays", "listens"],
    rows.map((x) => [x.award, x.period, x.releaseId, x.title, x.artistName, x.stats.score, x.stats.fires, x.stats.wins, x.stats.plays ?? 0, x.stats.listens]),
  );
}
