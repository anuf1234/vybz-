import { ACHIEVEMENTS, type AchievementDef, type AchievementMetric, type AchievementsResponse } from "@vybz/core";
import { type Database, type Executor, eq, inArray, schema, sql } from "@vybz/db";
import { createNotifications, type PushSender } from "./notifications";
import { grant } from "./progression";
import { streaksFor } from "./streaks";

/**
 * Achievements: a fixed catalog (in @vybz/core) checked against each person's
 * totals. Checks run after the things that move a total (a finished battle, a
 * vote, a post, a follow, a playlist); unlocking is idempotent.
 */

export type AchievementStats = Record<AchievementMetric, number>;

const ZERO: AchievementStats = {
  battlesPlayed: 0,
  battlesWon: 0,
  roundsWon: 0,
  flawlessWins: 0,
  genresWon: 0,
  dailyPlayed: 0,
  votesCast: 0,
  posts: 0,
  followers: 0,
  playlists: 0,
  bestWinStreak: 0,
  bestDailyStreak: 0,
  bestPlayStreak: 0,
};

export async function achievementStats(db: Executor, userId: string): Promise<AchievementStats> {
  const res = await db.execute<Record<string, number>>(sql`
    with mine as (
      select bp.id, bp.rounds_won, b.id as battle_id, b.winner_participant_id, b.daily_date, b.rules
      from battle_participant bp join battle b on b.id = bp.battle_id
      where bp.user_id = ${userId} and b.status = 'COMPLETE'
    ), won as (select * from mine where winner_participant_id = id)
    select
      (select count(*)::int from mine) as "battlesPlayed",
      (select count(*)::int from won) as "battlesWon",
      (select coalesce(sum(rounds_won), 0)::int from mine) as "roundsWon",
      (select count(*)::int from won w where not exists (
        select 1 from battle_participant o where o.battle_id = w.battle_id and o.id <> w.id and o.rounds_won > 0)) as "flawlessWins",
      (select count(distinct g)::int from won, jsonb_array_elements_text(
        case when jsonb_typeof(rules->'constraints'->'genres') = 'array' then rules->'constraints'->'genres' else '[]'::jsonb end) g) as "genresWon",
      (select count(*)::int from mine where daily_date is not null) as "dailyPlayed",
      (select count(*)::int from vote where voter_id = ${userId}) as "votesCast",
      (select count(*)::int from post where author_id = ${userId} and hidden_at is null) as "posts",
      (select count(*)::int from follow where followee_id = ${userId}) as "followers",
      (select count(*)::int from playlist where owner_id = ${userId}) as "playlists"
  `);
  const streaks = await streaksFor(db, userId);
  return { ...ZERO, ...(res.rows[0] ?? {}), bestWinStreak: streaks.wins.best, bestDailyStreak: streaks.daily.best, bestPlayStreak: streaks.play.best } as AchievementStats;
}

/**
 * Unlocks whatever these people have newly earned, tells them, and runs the
 * unlock hook. Never throws: progression must not break the action behind it.
 */
export async function checkAchievements(db: Database, push: PushSender | null | undefined, userIds: (string | null | undefined)[]): Promise<AchievementDef[]> {
  const unlocked: AchievementDef[] = [];
  for (const userId of new Set(userIds.filter((u): u is string => !!u))) {
    try {
      // Rewards can unlock more (XP → level achievements), so look twice at most.
      for (let pass = 0; pass < 3; pass++) {
        const fresh = await unlockFor(db, userId);
        if (!fresh.length) break;
        unlocked.push(...fresh);
        await createNotifications(
          db,
          push,
          fresh.map((d) => ({ userId, type: "ACHIEVEMENT_UNLOCKED" as const, title: `${d.icon} Achievement unlocked`, body: `${d.title}: ${d.description}`, battleId: null, link: "/achievements" })),
        );
        for (const d of fresh) await grant(db, userId, "ACHIEVEMENT", d.code, d);
      }
    } catch (err) {
      console.error("achievement check failed", userId, err);
    }
  }
  return unlocked;
}

async function unlockFor(db: Database, userId: string): Promise<AchievementDef[]> {
  const [stats, have] = await Promise.all([achievementStats(db, userId), unlockedCodes(db, userId)]);
  const due = ACHIEVEMENTS.filter((d) => !have.has(d.code) && (stats[d.metric] ?? 0) >= d.target);
  if (!due.length) return [];
  const rows = await db
    .insert(schema.userAchievement)
    .values(due.map((d) => ({ userId, code: d.code })))
    .onConflictDoNothing()
    .returning({ code: schema.userAchievement.code });
  const got = new Set(rows.map((r) => r.code));
  return due.filter((d) => got.has(d.code));
}

async function unlockedCodes(db: Executor, userId: string): Promise<Map<string, Date>> {
  const rows = await db.select().from(schema.userAchievement).where(eq(schema.userAchievement.userId, userId));
  return new Map(rows.map((r) => [r.code, r.unlockedAt]));
}

export async function achievementsFor(db: Executor, userId: string): Promise<AchievementsResponse> {
  const [stats, have] = await Promise.all([achievementStats(db, userId), unlockedCodes(db, userId)]);
  const items = ACHIEVEMENTS.map((d) => {
    const at = have.get(d.code);
    return {
      code: d.code,
      title: d.title,
      description: d.description,
      icon: d.icon,
      target: d.target,
      progress: at ? d.target : Math.min(d.target, stats[d.metric] ?? 0),
      xp: d.xp,
      coins: d.coins,
      unlockedAt: at?.toISOString() ?? null,
    };
  });
  // Unlocked first (newest first), then closest to done.
  items.sort((x, y) =>
    x.unlockedAt && y.unlockedAt ? y.unlockedAt.localeCompare(x.unlockedAt) : x.unlockedAt ? -1 : y.unlockedAt ? 1 : y.progress / y.target - x.progress / x.target,
  );
  return { items, unlocked: have.size, total: ACHIEVEMENTS.length };
}

/** Unlocked counts for profile headers. */
export async function unlockedCounts(db: Executor, userIds: string[]): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const rows = await db
    .select({ userId: schema.userAchievement.userId, n: sql<number>`count(*)::int` })
    .from(schema.userAchievement)
    .where(inArray(schema.userAchievement.userId, userIds))
    .groupBy(schema.userAchievement.userId);
  return new Map(rows.map((r) => [r.userId, r.n]));
}
