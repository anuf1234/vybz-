import { DROP_AWARDS, type DropAwardKind, type DropAwardView, type HeatRow, type HeatStats, type TopDropsResponse, heatScore, isoWeek, weekStart } from "@vybz/core";
import { type Executor, and, desc, eq, gte, inArray, lt, newId, schema, sql } from "@vybz/db";
import type { BattleDeps, UserRow } from "./battles/service";
import { botUser } from "./bot";
import { type ReleaseRow, views } from "./drops";
import { createNotifications } from "./notifications";
import { shiftDay } from "./progression";

/**
 * Song of the Day, Song of the Week and Album of the Week. Like Apple
 * Music's charts, the app shows positions only; the counts behind them are
 * kept (drop_award.stats, release_day_stats) for partners and never sent
 * to the app.
 * A release's heat
 * in a period counts fans' fires and This-or-That wins and the people who
 * tapped out to listen (one listen per person per release per period).
 * Leaders are live; when a day or week ends its winner is frozen, posted
 * from the VYBZ account, and the artist's followers are told.
 */

const SONG = ["SINGLE"];
const ALBUM = ["ALBUM", "EP", "MIXTAPE"];
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

interface Window {
  start: Date;
  end: Date;
}

const dayWindow = (day: string): Window => ({ start: new Date(`${day}T00:00:00Z`), end: new Date(`${shiftDay(day, 1)}T00:00:00Z`) });
const weekWindow = (week: string): Window => {
  const start = weekStart(week);
  return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
};

/** Heat per release in a window, for releases of the given kinds. */
export async function heat(db: Executor, w: Window, kinds: string[]): Promise<Map<string, HeatStats>> {
  const r = schema.release;
  const [fires, wins, listens, plays] = await Promise.all([
    db
      .select({ id: schema.releaseFire.releaseId, n: sql<number>`count(*)::int` })
      .from(schema.releaseFire)
      .innerJoin(r, eq(r.id, schema.releaseFire.releaseId))
      .where(and(gte(schema.releaseFire.createdAt, w.start), lt(schema.releaseFire.createdAt, w.end), inArray(r.kind, kinds), eq(r.status, "LIVE")))
      .groupBy(schema.releaseFire.releaseId),
    db
      .select({ id: schema.releaseDuel.winnerId, n: sql<number>`count(*)::int` })
      .from(schema.releaseDuel)
      .innerJoin(r, eq(r.id, schema.releaseDuel.winnerId))
      .where(and(gte(schema.releaseDuel.createdAt, w.start), lt(schema.releaseDuel.createdAt, w.end), inArray(r.kind, kinds), eq(r.status, "LIVE")))
      .groupBy(schema.releaseDuel.winnerId),
    db
      .select({ id: schema.outboundClick.ref, n: sql<number>`count(distinct coalesce(${schema.outboundClick.userId}, ${schema.outboundClick.viewerKey}))::int` })
      .from(schema.outboundClick)
      .innerJoin(r, eq(r.id, schema.outboundClick.ref))
      .where(and(eq(schema.outboundClick.kind, "release"), gte(schema.outboundClick.createdAt, w.start), lt(schema.outboundClick.createdAt, w.end), inArray(r.kind, kinds), eq(r.status, "LIVE")))
      .groupBy(schema.outboundClick.ref),
    db
      .select({ id: schema.playEvent.releaseId, n: sql<number>`count(distinct ${schema.playEvent.userId})::int` })
      .from(schema.playEvent)
      .innerJoin(r, eq(r.id, schema.playEvent.releaseId))
      .where(and(gte(schema.playEvent.createdAt, w.start), lt(schema.playEvent.createdAt, w.end), inArray(r.kind, kinds), eq(r.status, "LIVE")))
      .groupBy(schema.playEvent.releaseId),
  ]);
  const out = new Map<string, HeatStats>();
  const get = (id: string) => out.get(id) ?? { score: 0, fires: 0, wins: 0, listens: 0, plays: 0 };
  for (const f of fires) out.set(f.id, { ...get(f.id), fires: f.n });
  for (const x of wins) out.set(x.id, { ...get(x.id), wins: x.n });
  for (const l of listens) out.set(l.id, { ...get(l.id), listens: l.n });
  for (const p of plays) out.set(p.id, { ...get(p.id), plays: p.n });
  for (const [id, s] of out) out.set(id, { ...s, score: heatScore(s) });
  return out;
}

/** Highest heat first; ties go to more fires, then more listens. */
function ranked(stats: Map<string, HeatStats>): [string, HeatStats][] {
  return [...stats.entries()].filter(([, s]) => s.score > 0).sort(([, a], [, b]) => b.score - a.score || b.fires - a.fires || (b.plays ?? 0) - (a.plays ?? 0) || b.listens - a.listens);
}

async function rows(db: Executor, viewer: UserRow | null, list: [string, HeatStats][], limit: number): Promise<HeatRow[]> {
  const top = list.slice(0, limit);
  if (!top.length) return [];
  const rels = await db.select().from(schema.release).where(inArray(schema.release.id, top.map(([id]) => id)));
  const v = await views(db, viewer, rels as ReleaseRow[]);
  return top.flatMap(([id], i) => {
    const release = v.find((x) => x.id === id);
    return release ? [{ rank: i + 1, release }] : [];
  });
}

export async function topDrops(deps: BattleDeps, viewer: UserRow | null, now = new Date()): Promise<TopDropsResponse> {
  const day = utcDay(now);
  const week = isoWeek(now);
  const [songsToday, songsWeek, albumsWeek, awards] = await Promise.all([
    heat(deps.db, dayWindow(day), SONG),
    heat(deps.db, weekWindow(week), SONG),
    heat(deps.db, weekWindow(week), ALBUM),
    deps.db.select().from(schema.dropAward).orderBy(desc(schema.dropAward.createdAt)).limit(21),
  ]);
  const rels = awards.length ? await deps.db.select().from(schema.release).where(inArray(schema.release.id, awards.map((a) => a.releaseId))) : [];
  const v = await views(deps.db, viewer, rels as ReleaseRow[]);
  const history: DropAwardView[] = awards.flatMap((a) => {
    const release = v.find((x) => x.id === a.releaseId);
    return release ? [{ award: a.award as DropAwardKind, period: a.period, release }] : [];
  });
  return {
    day,
    week,
    songsToday: await rows(deps.db, viewer, ranked(songsToday), 10),
    songsWeek: await rows(deps.db, viewer, ranked(songsWeek), 10),
    albumsWeek: await rows(deps.db, viewer, ranked(albumsWeek), 10),
    history,
  };
}

/** Freezes one award if its period is over and it hasn't been given yet. */
async function give(deps: BattleDeps, award: DropAwardKind, period: string, w: Window, kinds: string[]): Promise<boolean> {
  const [done] = await deps.db.select({ p: schema.dropAward.period }).from(schema.dropAward).where(and(eq(schema.dropAward.award, award), eq(schema.dropAward.period, period)));
  if (done) return false;
  const [win] = ranked(await heat(deps.db, w, kinds));
  if (!win) return false;
  const [id, stats] = win;
  const [claimed] = await deps.db.insert(schema.dropAward).values({ award, period, releaseId: id, stats }).onConflictDoNothing().returning();
  if (!claimed) return false;
  const [rel] = await deps.db.select().from(schema.release).where(eq(schema.release.id, id));
  if (!rel) return true;
  const a = DROP_AWARDS[award];
  try {
    const bot = await botUser(deps);
    const postId = newId();
    await deps.db.insert(schema.post).values({ id: postId, authorId: bot.id, body: `${a.icon} ${a.label}: ${rel.title} by ${rel.artistName}\n\nChosen by what VYBZ fans played and voted for.` });
    await deps.db.update(schema.dropAward).set({ postId }).where(and(eq(schema.dropAward.award, award), eq(schema.dropAward.period, period)));
  } catch (err) {
    console.error("award post failed", err);
  }
  const fans = await deps.db
    .selectDistinct({ userId: schema.artistFollow.userId })
    .from(schema.artistFollow)
    .where(sql`lower(${schema.artistFollow.name}) = ${rel.artistName.trim().toLowerCase()}`);
  await createNotifications(
    deps.db,
    deps.push,
    fans.map((f) => ({ userId: f.userId, type: "DROP_AWARD" as const, title: `${a.icon} ${rel.artistName} has the ${a.label}`, body: `"${rel.title}" was the most-played and most-loved on VYBZ.`, battleId: null, link: "/drops/top" })),
  );
  return true;
}

/** Scheduler: yesterday's Song of the Day, and on Mondays last week's Song and Album of the Week. */
export async function giveDropAwards(deps: BattleDeps, now = new Date()): Promise<number> {
  const yesterday = shiftDay(utcDay(now), -1);
  const lastWeek = isoWeek(new Date(now.getTime() - 7 * 86_400_000));
  let n = 0;
  if (await give(deps, "SONG_DAY", yesterday, dayWindow(yesterday), SONG)) n++;
  if (await give(deps, "SONG_WEEK", lastWeek, weekWindow(lastWeek), SONG)) n++;
  if (await give(deps, "ALBUM_WEEK", lastWeek, weekWindow(lastWeek), ALBUM)) n++;
  return n;
}
