import { ratingFor } from "./ranked";
import { type BattleRulesInput, DECADES, GENRE_KEYS, MATCHMAKING, type QuickBattleResponse, RANKED, decadeLabel, genreLabel, rankMatches, regionOf, themeLabel } from "@vybz/core";
import { and, asc, eq, inArray, lte, schema, sql } from "@vybz/db";
import { z } from "zod";
import { type BattleDeps, ServiceError, type UserRow, acceptBattle, createBattle } from "./battles/service";
import { botUser } from "./bot";
import { isBlockedBetween } from "./social";

/**
 * Quick Battle: one tap to a duel. Smart matchmaking picks the best waiting
 * battle for you (vibe, skill, region, how long they've waited; see
 * rankMatches), or opens one of yours. Waiting battles accept a wider vibe
 * as time passes. With the AI judge set up, the VYBZ bot takes a quick
 * battle nobody has taken within BOT_AFTER_MS, but only if the player said
 * yes to that up front, or straight away if they ask for it. Quick battles
 * are AI-judged when the judge is available: 3 rounds, 30 minutes to pick.
 */

export const BOT_AFTER_MS = MATCHMAKING.botAfterMs;

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
    /** Let the VYBZ bot take it if nobody does in time (default yes; ranked never). */
    botFallback: z.boolean().optional(),
    /** The phone's IANA time zone, for matching people in the same part of the world. */
    timeZone: z.string().max(64).optional(),
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

interface Waiting {
  id: string;
  creatorId: string;
  createdAt: Date;
  genre: string | null;
  decade: number | null;
}

/** Every waiting quick battle of this kind, oldest first, with its vibe. */
async function waiting(deps: BattleDeps, ranked: boolean): Promise<Waiting[]> {
  const b = schema.battle;
  const rows = await deps.db
    .select({ id: b.id, creatorId: b.creatorId, createdAt: b.createdAt, rules: b.rules })
    .from(b)
    .where(and(eq(b.quickMatch, true), eq(b.status, "OPEN_CHALLENGE"), eq(b.visibility, "PUBLIC"), eq(b.ranked, ranked)))
    .orderBy(asc(b.createdAt))
    .limit(60);
  return rows.map((r) => {
    const c = (r.rules as { constraints?: { genres?: string[]; eraFrom?: number } }).constraints;
    return { id: r.id, creatorId: r.creatorId, createdAt: r.createdAt, genre: c?.genres?.length === 1 ? c.genres[0]! : null, decade: c?.eraFrom ?? null };
  });
}

/** Skill and region for matchmaking: ranked rating (start rating if none) and time-zone region. */
async function profiles(deps: BattleDeps, ids: string[]): Promise<Map<string, { rating: number; region: string | null }>> {
  const out = new Map<string, { rating: number; region: string | null }>();
  if (!ids.length) return out;
  const [ratings, zones] = await Promise.all([
    deps.db.select({ id: schema.userRating.userId, rating: schema.userRating.rating }).from(schema.userRating).where(inArray(schema.userRating.userId, ids)),
    deps.db.select({ id: schema.userProgress.userId, tz: schema.userProgress.timeZone }).from(schema.userProgress).where(inArray(schema.userProgress.userId, ids)),
  ]);
  for (const id of ids) out.set(id, { rating: ratings.find((r) => r.id === id)?.rating ?? RANKED.start, region: regionOf(zones.find((z) => z.id === id)?.tz) });
  return out;
}

/** A waiting battle that widened to fit the person taking it gets the new vibe (title, theme and rules). */
async function retheme(deps: BattleDeps, id: string, genre: string | null, decade: number | null, ranked: boolean): Promise<void> {
  const [row] = await deps.db.select({ rules: schema.battle.rules }).from(schema.battle).where(eq(schema.battle.id, id));
  if (!row) return;
  const rules = row.rules as Record<string, unknown>;
  const constraints = { ...(genre ? { genres: [genre] } : {}), ...(decade ? { eraFrom: decade, eraTo: decade + 9 } : {}) };
  const next = { ...rules, constraints: Object.keys(constraints).length ? constraints : undefined };
  await deps.db
    .update(schema.battle)
    .set({ rules: next, title: `${ranked ? "Ranked: " : ""}${title(genre, decade)}`, theme: themeLabel(constraints) })
    .where(and(eq(schema.battle.id, id), eq(schema.battle.status, "OPEN_CHALLENGE")));
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
    // Smart matchmaking: the best waiting battle for you, not just the oldest exact match.
    const all = (await waiting(deps, ranked)).filter((w) => w.creatorId !== user.id);
    const people = await profiles(deps, [user.id, ...new Set(all.map((w) => w.creatorId))]);
    const meP = people.get(user.id)!;
    const region = regionOf(parsed.data.timeZone) ?? meP.region;
    const options = rankMatches(
      { genre, decade, rating: ranked ? myRating : meP.rating, region },
      all.map((w) => ({ id: w.id, genre: w.genre, decade: w.decade, rating: people.get(w.creatorId)!.rating, region: people.get(w.creatorId)!.region, waitingMs: now.getTime() - w.createdAt.getTime() })),
      { ranked },
    );
    for (const o of options) {
      const w = all.find((x) => x.id === o.id)!;
      if (await isBlockedBetween(deps.db, user.id, w.creatorId)) continue;
      try {
        if (o.widened) await retheme(deps, o.id, o.genre, o.decade, ranked);
        await acceptBattle(deps, user, o.id);
        return { id: o.id, matched: "player" };
      } catch (err) {
        if (err instanceof ServiceError && err.status === 409) continue; // taken a moment ago
        throw err;
      }
    }
  }

  // Reuse your own waiting quick battle for this theme rather than opening another.
  const mine = (await waiting(deps, ranked)).find((w) => w.creatorId === user.id && w.genre === genre && w.decade === decade);
  const botFallback = !ranked && parsed.data.botFallback !== false;
  const id =
    mine?.id ??
    (await createBattle(deps, user, { title: `${ranked ? "Ranked: " : ""}${title(genre, decade)}`, rules: quickRules({ genre, decade, ai }) }, { quickMatch: true, ranked, botFallback })).id;
  if (mine) await deps.db.update(schema.battle).set({ botFallback }).where(eq(schema.battle.id, mine.id));

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
    .where(and(eq(b.quickMatch, true), eq(b.ranked, false), eq(b.botFallback, true), eq(b.status, "OPEN_CHALLENGE"), lte(b.createdAt, new Date(now.getTime() - BOT_AFTER_MS))))
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
