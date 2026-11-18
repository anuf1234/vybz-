import {
  DAILY_LADDER,
  EARN,
  type LedgerReason,
  type WalletResponse,
  achievementDef,
  shopItem,
  battleReward, type DailyClaimResponse, type DailyRewardState, type ProgressView, type Reward, ladderDay, levelForXp, levelProgress, levelUpCoins,
} from "@vybz/core";
import { type BattleAggregate } from "@vybz/core";
import { type Database, type Executor, and, desc, eq, gte, inArray, lt, newId, or, schema, sql } from "@vybz/db";
import { z } from "zod";
import { checkAchievements } from "./achievements";
import { ServiceError, type UserRow } from "./battles/service";
import { type PushSender, createNotifications } from "./notifications";
import { streaksFor } from "./streaks";

/**
 * The XP and coin ledger, and daily rewards. Every award is a ledger row
 * keyed by (user, reason, ref), so retries and races can't pay twice.
 */


export interface Balance {
  xp: number;
  coins: number;
  level: number;
}

/**
 * Records an award once. Returns the new balance, or null if it was already
 * granted. Crossing a level pays its level-up coins (also once per level) and
 * leaves an in-app notification.
 */
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
    const reached = levelForXp(bal!.xp);
    if (reached <= bal!.level) return bal!;
    let coins = 0;
    for (let l = bal!.level + 1; l <= reached; l++) {
      const [paid] = await tx
        .insert(schema.ledgerEntry)
        .values({ id: newId(), userId, reason: "LEVEL_UP", ref: String(l), coins: levelUpCoins(l) })
        .onConflictDoNothing()
        .returning({ coins: schema.ledgerEntry.coins });
      coins += paid?.coins ?? 0;
    }
    const [after] = await tx
      .update(p)
      .set({ level: reached, coins: sql`${p.coins} + ${coins}` })
      .where(eq(p.userId, userId))
      .returning({ xp: p.xp, coins: p.coins, level: p.level });
    await createNotifications(tx, null, [
      { userId, type: "LEVEL_UP", title: `⭐ Level ${reached}`, body: `You reached level ${reached}${coins ? ` and earned ${coins} coins` : ""}.`, battleId: null, link: "/wallet" },
    ]);
    return after!;
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

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

async function dailyStateWith(db: Executor, userId: string, tz: string, at: Date): Promise<DailyRewardState & { nextStreakDay: number; frozenDays: string[] }> {
  const [[last], progress] = await Promise.all([
    db.select().from(schema.dailyClaim).where(eq(schema.dailyClaim.userId, userId)).orderBy(desc(schema.dailyClaim.day)).limit(1),
    db.select().from(schema.userProgress).where(eq(schema.userProgress.userId, userId)),
  ]);
  const today = localDay(at, tz);
  const claimedToday = last?.day === today;
  const zoneChanged = Boolean(progress[0]?.timeZone && progress[0].timeZone !== tz);
  const canClaim = !last || (today > last.day && (!zoneChanged || at.getTime() - last.createdAt.getTime() >= ZONE_CHANGE_GAP_MS));
  // Missed days a held streak freeze can cover (used when you next claim).
  const missed = last && last.day < today ? daysBetween(last.day, today) - 1 : 0;
  const covered = missed >= 1 && missed <= (progress[0]?.streakFreezes ?? 0);
  const frozenDays = covered ? Array.from({ length: missed }, (_, i) => shiftDay(last!.day, i + 1)) : [];
  const alive = last ? last.day >= shiftDay(today, -1) || covered : false;
  const streak = alive ? last!.streakDay : 0;
  const nextStreakDay = alive && !claimedToday && last!.day < today ? last!.streakDay + frozenDays.length + 1 : alive ? last!.streakDay : 1;
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
    streakFreezes: progress[0]?.streakFreezes ?? 0,
    nextStreakDay,
    frozenDays,
  };
}

export async function dailyState(db: Executor, user: UserRow | null, tzIn: unknown, at = new Date()): Promise<DailyRewardState> {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  const { nextStreakDay: _n, frozenDays: _f, ...state } = await dailyStateWith(db, user.id, validTimeZone(tzIn) ?? "UTC", at);
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
    if (s.frozenDays.length) {
      const base = s.nextStreakDay - s.frozenDays.length - 1;
      await tx.insert(schema.dailyClaim).values(s.frozenDays.map((day, i) => ({ userId: user.id, day, streakDay: base + i + 1, frozen: true, createdAt: at })));
      await tx
        .update(schema.userProgress)
        .set({ streakFreezes: sql`${schema.userProgress.streakFreezes} - ${s.frozenDays.length}` })
        .where(eq(schema.userProgress.userId, user.id));
    }
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
  const [bal, streaks] = await Promise.all([balanceOf(db, userId), streaksFor(db, userId)]);
  return { ...levelProgress(bal.xp), coins: bal.coins, streaks };
}

// ── Earning ────────────────────────────────────────────────────────────────

/** XP and coins for everyone who played a finished battle. Once per battle per person. */
export async function awardBattle(db: Database, agg: BattleAggregate): Promise<void> {
  const system = await systemIds(db, agg.participants.map((p) => p.userId));
  for (const p of agg.participants) {
    if (system.has(p.userId)) continue;
    const won = agg.winnerParticipantId === p.id;
    const roundsWon = agg.rounds.filter((r) => r.winnerParticipantId === p.id).length;
    await grant(db, p.userId, "BATTLE", agg.id, battleReward({ won, roundsWon }));
  }
}

async function awardedToday(db: Executor, userId: string, reason: LedgerReason, at: Date): Promise<number> {
  const since = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.ledgerEntry)
    .where(and(eq(schema.ledgerEntry.userId, userId), eq(schema.ledgerEntry.reason, reason), gte(schema.ledgerEntry.createdAt, since)));
  return row?.n ?? 0;
}

/** A little XP for voting, up to a daily cap (UTC days). */
export async function awardVote(db: Database, userId: string, battleId: string, roundIndex: number, at = new Date()): Promise<void> {
  if ((await awardedToday(db, userId, "VOTE", at)) >= EARN.votesPerDay) return;
  await grant(db, userId, "VOTE", `${battleId}:${roundIndex}`, EARN.vote);
}

export async function awardPost(db: Database, userId: string, postId: string, at = new Date()): Promise<void> {
  if ((await awardedToday(db, userId, "POST", at)) >= EARN.postsPerDay) return;
  await grant(db, userId, "POST", postId, EARN.post);
}

// ── Wallet ─────────────────────────────────────────────────────────────────

const PAGE = 50;

/** Balance plus history, newest first. Cursor: "<ISO time>_<id>". */
export async function wallet(db: Executor, user: UserRow | null, cursor?: string | null): Promise<WalletResponse> {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  const l = schema.ledgerEntry;
  const conds = [eq(l.userId, user.id)];
  if (cursor) {
    const i = cursor.lastIndexOf("_");
    const t = new Date(cursor.slice(0, i));
    const id = cursor.slice(i + 1);
    if (i < 0 || Number.isNaN(t.getTime())) throw new ServiceError(400, "INVALID_CURSOR");
    conds.push(or(lt(l.createdAt, t), and(eq(l.createdAt, t), lt(l.id, id)))!);
  }
  const [bal, rows] = await Promise.all([balanceOf(db, user.id), db.select().from(l).where(and(...conds)).orderBy(desc(l.createdAt), desc(l.id)).limit(PAGE + 1)]);
  const page = rows.slice(0, PAGE);
  const battleIds = [...new Set(page.flatMap((r) => (r.reason === "BATTLE" ? [r.ref] : r.reason === "VOTE" ? [r.ref.split(":")[0]!] : [])))];
  const titles = battleIds.length
    ? new Map((await db.select({ id: schema.battle.id, title: schema.battle.title }).from(schema.battle).where(inArray(schema.battle.id, battleIds))).map((b) => [b.id, b.title]))
    : new Map<string, string>();
  const label = (r: (typeof page)[number]): { label: string; link: string | null } => {
    switch (r.reason as LedgerReason) {
      case "DAILY":
        return { label: "Daily reward", link: null };
      case "ACHIEVEMENT": {
        const d = achievementDef(r.ref);
        return { label: d ? `${d.icon} ${d.title}` : "Achievement", link: "/achievements" };
      }
      case "LEVEL_UP":
        return { label: `Reached level ${r.ref}`, link: null };
      case "BATTLE":
        return { label: `Battle: ${titles.get(r.ref) ?? "a battle"}`, link: `/battle/${r.ref}` };
      case "VOTE": {
        const [id, round] = r.ref.split(":");
        return { label: `Voted in round ${Number(round) + 1} of ${titles.get(id!) ?? "a battle"}`, link: `/battle/${id}` };
      }
      case "POST":
        return { label: "Posted", link: `/post/${r.ref}` };
      case "PURCHASE": {
        const item = shopItem(r.ref.split(":")[0]);
        return { label: `Bought ${item ? `${item.icon} ${item.title}` : "an item"}`, link: "/shop" };
      }
      case "WAR_VOTE":
        return { label: "Voted in an album war", link: `/wars/${r.ref}` };
      case "PARTY":
        return { label: r.ref.endsWith(":win") ? "Won a party game" : "Played a party game", link: null };
      case "DJ_LESSON":
        return { label: `DJ University: ${r.ref}`, link: "/dj" };
      case "DJ_BATTLE":
        return { label: "DJ battle", link: "/dj" };
      case "TRIVIA":
        return { label: r.ref.startsWith("daily:") ? `Daily trivia ${r.ref.slice(6)}` : "Trivia practice", link: "/trivia" };
      default:
        return { label: r.reason, link: null };
    }
  };
  const last = page[page.length - 1];
  return {
    ...levelProgress(bal.xp),
    coins: bal.coins,
    history: page.map((r) => ({ id: r.id, reason: r.reason as LedgerReason, ...label(r), xp: r.xp, coins: r.coins, createdAt: r.createdAt.toISOString() })),
    nextCursor: rows.length > PAGE && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
  };
}

/** VYBZ's own accounts among these ids: they earn nothing. */
export async function systemIds(db: Executor, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ id: schema.user.id }).from(schema.user).where(and(inArray(schema.user.id, ids), eq(schema.user.isSystem, true)));
  return new Set(rows.map((r) => r.id));
}
