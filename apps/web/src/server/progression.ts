import { DAILY_LADDER, type DailyClaimResponse, type DailyRewardState, type ProgressView, type Reward, ladderDay } from "@vybz/core";
import { type Database, type Executor, desc, eq, newId, schema, sql } from "@vybz/db";
import { z } from "zod";
import { checkAchievements } from "./achievements";
import { ServiceError, type UserRow } from "./battles/service";
import type { PushSender } from "./notifications";
import { streaksFor } from "./streaks";

/**
 * The XP and coin ledger, and daily rewards. Every award is a ledger row
 * keyed by (user, reason, ref), so retries and races can't pay twice.
 */

export type LedgerReason = "DAILY" | "ACHIEVEMENT";

export interface Balance {
  xp: number;
  coins: number;
  level: number;
}

/** Records an award once. Returns the new balance, or null if it was already granted. */
export async function grant(db: Executor, userId: string, reason: LedgerReason, ref: string, r: Reward): Promise<Balance | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.ledgerEntry)
      .values({ id: newId(), userId, reason, ref, xp: r.xp, coins: r.coins })
      .onConflictDoNothing()
      .returning({ id: schema.ledgerEntry.id });
    if (!row) return null;
    const p = schema.userProgress;
    const [bal] = await tx
      .insert(p)
      .values({ userId, xp: r.xp, coins: r.coins })
      .onConflictDoUpdate({ target: p.userId, set: { xp: sql`${p.xp} + ${r.xp}`, coins: sql`${p.coins} + ${r.coins}` } })
      .returning({ xp: p.xp, coins: p.coins, level: p.level });
    return bal!;
  });
}

export async function balanceOf(db: Executor, userId: string): Promise<Balance> {
  const [row] = await db.select().from(schema.userProgress).where(eq(schema.userProgress.userId, userId));
  return { xp: row?.xp ?? 0, coins: row?.coins ?? 0, level: row?.level ?? 1 };
}

// ── Days ───────────────────────────────────────────────────────────────────

export function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== "string" || !tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** YYYY-MM-DD for `at` in `tz`. */
export function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}

// ── Daily rewards ──────────────────────────────────────────────────────────

/** After a time-zone change, a new "day" only counts once this much real time has passed. */
const ZONE_CHANGE_GAP_MS = 4 * 3600_000;

async function dailyStateWith(db: Executor, userId: string, tz: string, at: Date): Promise<DailyRewardState & { nextStreakDay: number }> {
  const [[last], progress] = await Promise.all([
    db.select().from(schema.dailyClaim).where(eq(schema.dailyClaim.userId, userId)).orderBy(desc(schema.dailyClaim.day)).limit(1),
    db.select().from(schema.userProgress).where(eq(schema.userProgress.userId, userId)),
  ]);
  const today = localDay(at, tz);
  const claimedToday = last?.day === today;
  const zoneChanged = Boolean(progress[0]?.timeZone && progress[0].timeZone !== tz);
  const canClaim = !last || (today > last.day && (!zoneChanged || at.getTime() - last.createdAt.getTime() >= ZONE_CHANGE_GAP_MS));
  const alive = last ? last.day >= shiftDay(today, -1) : false;
  const streak = alive ? last!.streakDay : 0;
  const nextStreakDay = alive && !claimedToday && last!.day < today ? last!.streakDay + 1 : alive ? last!.streakDay : 1;
  const step = claimedToday || !canClaim ? ladderDay(streak || 1) : ladderDay(nextStreakDay);
  return {
    today,
    claimedToday,
    canClaim,
    streak,
    ladderDay: step,
    reward: DAILY_LADDER[step - 1]!,
    ladder: [...DAILY_LADDER],
    balance: { xp: progress[0]?.xp ?? 0, coins: progress[0]?.coins ?? 0 },
    nextStreakDay,
  };
}

export async function dailyState(db: Executor, user: UserRow | null, tzIn: unknown, at = new Date()): Promise<DailyRewardState> {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  const { nextStreakDay: _n, ...state } = await dailyStateWith(db, user.id, validTimeZone(tzIn) ?? "UTC", at);
  return state;
}

const ClaimSchema = z.object({ timeZone: z.string().max(64).optional() }).strict();

export async function claimDaily(db: Database, push: PushSender | null | undefined, user: UserRow | null, body: unknown, at = new Date()): Promise<DailyClaimResponse> {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  const parsed = ClaimSchema.safeParse(body ?? {});
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST");
  const tz = validTimeZone(parsed.data.timeZone) ?? "UTC";

  const reward = await db.transaction(async (tx) => {
    // Serialize claims per person on their progress row.
    await tx.insert(schema.userProgress).values({ userId: user.id }).onConflictDoNothing();
    await tx.select().from(schema.userProgress).where(eq(schema.userProgress.userId, user.id)).for("update");
    const s = await dailyStateWith(tx, user.id, tz, at);
    if (!s.canClaim) throw new ServiceError(409, "ALREADY_CLAIMED", "You've claimed today's reward. Come back tomorrow.");
    const r = DAILY_LADDER[ladderDay(s.nextStreakDay) - 1]!;
    await tx.insert(schema.dailyClaim).values({ userId: user.id, day: s.today, streakDay: s.nextStreakDay, createdAt: at });
    await grant(tx, user.id, "DAILY", s.today, r);
    await tx.update(schema.userProgress).set({ timeZone: tz }).where(eq(schema.userProgress.userId, user.id));
    return r;
  });
  await checkAchievements(db, push, [user.id]);
  return { reward, state: await dailyState(db, user, tz, at) };
}

// ── Profile summary ────────────────────────────────────────────────────────

export async function progressFor(db: Executor, userId: string): Promise<ProgressView> {
  return { streaks: await streaksFor(db, userId) };
}
