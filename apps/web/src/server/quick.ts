import { ratingFor } from "./ranked";
import { type BattleRulesInput, DECADES, GENRE_KEYS, type QuickBattleResponse, decadeLabel, genreLabel, matchWindow } from "@vybz/core";
import { and, asc, eq, lte, ne, schema, sql } from "@vybz/db";
import { z } from "zod";
import { type BattleDeps, ServiceError, type UserRow, acceptBattle, createBattle } from "./battles/service";
import { botUser } from "./bot";
import { isBlockedBetween } from "./social";

/**
 * Quick Battle: one tap to a duel. Takes the oldest waiting quick battle that
 * fits (someone else's), or opens one of yours. With the AI judge set up, the
 * VYBZ bot takes a quick battle nobody has taken within BOT_AFTER_MS, or
 * straight away if you ask for it. Quick battles are AI-judged when the judge
 * is available, so nobody waits on a crowd: 3 rounds, 30 minutes to pick.
 */

export const BOT_AFTER_MS = 2 * 60_000;

const QuickSchema = z
  .object({
    genre: z.enum(GENRE_KEYS).nullish(),
    decade: z
      .number()
      .int()
      .refine((d) => (DECADES as readonly number[]).includes(d))
      .nullish(),
    vsBot: z.boolean().optional(),
    /** Matched by rating; the result moves both ratings. Never against the bot. */
    ranked: z.boolean().optional(),
  })
  .strict();

export function quickRules(o: { genre?: string | null; decade?: number | null; ai: boolean }): BattleRulesInput {
  return {
    roundCount: 3,
    tracksPerRound: 1,
    challengeExpiryHours: 1,
    judging: { mode: o.ai ? "AI" : "CROWD", aiWeightPercent: 30 },
    timing: { submissionWindowMinutes: 30, votingWindowMinutes: o.ai ? 5 : 30 },
    constraints: {
      ...(o.genre ? { genres: [o.genre as (typeof GENRE_KEYS)[number]] } : {}),
      ...(o.decade ? { eraFrom: o.decade, eraTo: o.decade + 9 } : {}),
    },
  } as BattleRulesInput;
}

function title(genre?: string | null, decade?: number | null): string {
  const label = [decade ? decadeLabel(decade) : null, genre ? genreLabel(genre) : null].filter(Boolean).join(" ");
  return `Quick battle${label ? `: ${label}` : ""}`;
}

/** Waiting quick battles that fit, oldest first. */
async function waiting(deps: BattleDeps, genre: string | null, decade: number | null, notBy?: string, ranked = false) {
  const b = schema.battle;
  const conds = [eq(b.quickMatch, true), eq(b.status, "OPEN_CHALLENGE"), eq(b.visibility, "PUBLIC"), eq(b.ranked, ranked)];
  if (notBy) conds.push(ne(b.creatorId, notBy));
  conds.push(genre ? sql`(${b.rules} -> 'constraints' -> 'genres') = ${JSON.stringify([genre])}::jsonb` : sql`(${b.rules} -> 'constraints' -> 'genres') is null`);
  conds.push(decade ? sql`(${b.rules} -> 'constraints' ->> 'eraFrom')::int = ${decade}` : sql`(${b.rules} -> 'constraints' -> 'eraFrom') is null`);
  return deps.db.select({ id: b.id, creatorId: b.creatorId, createdAt: b.createdAt }).from(b).where(and(...conds)).orderBy(asc(b.createdAt)).limit(ranked ? 30 : 10);
}

export async function quickBattle(deps: BattleDeps, user: UserRow | null, body: unknown): Promise<QuickBattleResponse> {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  const parsed = QuickSchema.safeParse(body ?? {});
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  const genre = parsed.data.genre ?? null;
  const decade = parsed.data.decade ?? null;
  const ai = Boolean(deps.aiJudge);
  if (parsed.data.vsBot && !ai) throw new ServiceError(409, "BOT_UNAVAILABLE", "The VYBZ bot needs the AI judge, which isn't set up on this server.");
  const ranked = parsed.data.ranked === true;
  if (ranked && parsed.data.vsBot) throw new ServiceError(400, "RANKED_NO_BOT", "Ranked battles are against people only.");
  const now = deps.now?.() ?? new Date();
  const myRating = ranked ? (await ratingFor(deps.db, user.id, now)).rating : 0;

  if (!parsed.data.vsBot) {
    // Someone's already waiting: take their battle (ranked: within the rating window, closest first).
    let candidates = await waiting(deps, genre, decade, user.id, ranked);
    if (ranked) {
      const rated = await Promise.all(candidates.map(async (w) => ({ w, r: (await ratingFor(deps.db, w.creatorId, now)).rating })));
      candidates = rated
        .filter(({ w, r }) => Math.abs(r - myRating) <= matchWindow(now.getTime() - w.createdAt.getTime()))
        .sort((x, y) => Math.abs(x.r - myRating) - Math.abs(y.r - myRating))
        .map((x) => x.w);
    }
    for (const w of candidates) {
      if (await isBlockedBetween(deps.db, user.id, w.creatorId)) continue;
      try {
        await acceptBattle(deps, user, w.id);
        return { id: w.id, matched: "player" };
      } catch (err) {
        if (err instanceof ServiceError && err.status === 409) continue; // taken a moment ago
        throw err;
      }
    }
  }

  // Reuse your own waiting quick battle for this theme rather than opening another.
  const mine = (await waiting(deps, genre, decade, undefined, ranked)).find((w) => w.creatorId === user.id);
  const id = mine?.id ?? (await createBattle(deps, user, { title: `${ranked ? "Ranked: " : ""}${title(genre, decade)}`, rules: quickRules({ genre, decade, ai }) }, { quickMatch: true, ranked })).id;

  if (parsed.data.vsBot) {
    await acceptBattle(deps, await botUser(deps), id);
    return { id, matched: "bot" };
  }
  return { id, matched: "waiting" };
}

/** Scheduler: the bot takes quick battles nobody has taken in time. */
export async function botTakeStaleQuick(deps: BattleDeps): Promise<number> {
  if (!deps.aiJudge) return 0;
  const now = deps.now?.() ?? new Date();
  const b = schema.battle;
  const stale = await deps.db
    .select({ id: b.id })
    .from(b)
    .where(and(eq(b.quickMatch, true), eq(b.ranked, false), eq(b.status, "OPEN_CHALLENGE"), lte(b.createdAt, new Date(now.getTime() - BOT_AFTER_MS))))
    .limit(20);
  const bot = await botUser(deps);
  let n = 0;
  for (const { id } of stale) {
    try {
      await acceptBattle(deps, bot, id);
      n++;
    } catch (err) {
      console.warn("bot couldn't take quick battle", id, err);
    }
  }
  return n;
}
