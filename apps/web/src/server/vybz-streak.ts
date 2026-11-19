import { type VybzStreak, dayRuns } from "@vybz/core";
import { type Executor, and, desc, eq, gte, lt, schema, sql } from "@vybz/db";
import { daysBetween, localDay, shiftDay } from "./progression";

/**
 * The VYBZ streak: one per day for any battle pick, vote, war vote, trivia
 * game or fired-up drop, counted in the person's time zone. A gap of missed
 * days is covered by held streak freezes (the same freezes the daily reward
 * uses) when the person is next active.
 */

async function zoneOf(db: Executor, userId: string): Promise<{ tz: string; freezes: number; system: boolean }> {
  const [row] = await db
    .select({ tz: schema.userProgress.timeZone, freezes: schema.userProgress.streakFreezes, system: schema.user.isSystem })
    .from(schema.user)
    .leftJoin(schema.userProgress, eq(schema.userProgress.userId, schema.user.id))
    .where(eq(schema.user.id, userId));
  return { tz: row?.tz ?? "UTC", freezes: row?.freezes ?? 0, system: row?.system ?? false };
}

/** Marks today as active. Never throws; a streak problem must not fail the action that earned it. */
export async function recordActivity(db: Executor, userId: string, at = new Date()): Promise<void> {
  try {
    const { tz, freezes, system } = await zoneOf(db, userId);
    if (system) return;
    const today = localDay(at, tz);
    const [fresh] = await db.insert(schema.activityDay).values({ userId, day: today, createdAt: at }).onConflictDoNothing().returning();
    if (!fresh || freezes < 1) return;
    const [prev] = await db
      .select({ day: schema.activityDay.day })
      .from(schema.activityDay)
      .where(and(eq(schema.activityDay.userId, userId), lt(schema.activityDay.day, today)))
      .orderBy(desc(schema.activityDay.day))
      .limit(1);
    if (!prev) return;
    const gap = daysBetween(prev.day, today) - 1;
    if (gap < 1 || gap > freezes) return;
    // Spend the freezes only if they're still there (another request may have used them).
    const [spent] = await db
      .update(schema.userProgress)
      .set({ streakFreezes: sql`${schema.userProgress.streakFreezes} - ${gap}` })
      .where(and(eq(schema.userProgress.userId, userId), gte(schema.userProgress.streakFreezes, gap)))
      .returning({ userId: schema.userProgress.userId });
    if (!spent) return;
    await db
      .insert(schema.activityDay)
      .values(Array.from({ length: gap }, (_, i) => ({ userId, day: shiftDay(prev.day, i + 1), frozen: true, createdAt: at })))
      .onConflictDoNothing();
  } catch (err) {
    console.error("streak update failed", userId, err);
  }
}

export async function activityDays(db: Executor, userId: string): Promise<{ day: string; frozen: boolean }[]> {
  return db.select({ day: schema.activityDay.day, frozen: schema.activityDay.frozen }).from(schema.activityDay).where(eq(schema.activityDay.userId, userId));
}

export async function vybzStreak(db: Executor, userId: string, at = new Date()): Promise<VybzStreak> {
  const [{ tz, freezes }, days] = await Promise.all([zoneOf(db, userId), activityDays(db, userId)]);
  const today = localDay(at, tz);
  const run = dayRuns(
    days.map((d) => d.day),
    today,
  );
  return { ...run, activeToday: days.some((d) => d.day === today && !d.frozen), freezes };
}
