import { type Database, and, desc, eq, gte, isNotNull, schema, sql } from "@vybz/db";
import { createNotifications, type PushSender } from "./notifications";
import { localDay, shiftDay } from "./progression";

/**
 * "Your streak ends tonight": one evening nudge, in the person's own time
 * zone, for anyone with a daily-reward streak of 2+ days who hasn't claimed
 * today. At most one a day (reminder_sent), never outside the evening window.
 */

export const REMIND_FROM_HOUR = 19;
export const REMIND_UNTIL_HOUR = 22;

function localHour(at: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at));
}

export async function sendStreakReminders(db: Database, push: PushSender | null | undefined, at = new Date()): Promise<number> {
  // Anyone whose latest claim is recent enough to still have a live streak.
  const since = shiftDay(at.toISOString().slice(0, 10), -3);
  const rows = await db
    .selectDistinctOn([schema.dailyClaim.userId], {
      userId: schema.dailyClaim.userId,
      day: schema.dailyClaim.day,
      streakDay: schema.dailyClaim.streakDay,
      tz: schema.userProgress.timeZone,
      freezes: schema.userProgress.streakFreezes,
    })
    .from(schema.dailyClaim)
    .innerJoin(schema.userProgress, eq(schema.userProgress.userId, schema.dailyClaim.userId))
    .innerJoin(schema.user, eq(schema.user.id, schema.dailyClaim.userId))
    .where(and(gte(schema.dailyClaim.day, since), isNotNull(schema.userProgress.timeZone), eq(schema.user.status, "ACTIVE"), sql`${schema.dailyClaim.streakDay} >= 2`))
    .orderBy(schema.dailyClaim.userId, desc(schema.dailyClaim.day));

  let sent = 0;
  for (const r of rows) {
    const tz = r.tz!;
    const hour = localHour(at, tz);
    if (hour < REMIND_FROM_HOUR || hour >= REMIND_UNTIL_HOUR) continue;
    const today = localDay(at, tz);
    // Claimed today already, or the streak already lapsed: nothing to save.
    if (r.day !== shiftDay(today, -1)) continue;
    const [fresh] = await db.insert(schema.reminderSent).values({ userId: r.userId, kind: "STREAK", day: today }).onConflictDoNothing().returning();
    if (!fresh) continue;
    await createNotifications(db, push, [
      {
        userId: r.userId,
        type: "STREAK_REMINDER",
        title: `🔥 Your ${r.streakDay}-day streak ends tonight`,
        body: r.freezes > 0 ? "Claim today's reward to keep it going (a streak freeze will cover you if you miss it)." : "Claim today's reward to keep it going.",
        battleId: null,
        link: "/",
      },
    ]);
    sent++;
  }
  return sent;
}
