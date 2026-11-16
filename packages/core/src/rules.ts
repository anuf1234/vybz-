import { z } from "zod";
import { GENRE_KEYS } from "./genres";

/**
 * Battle rules, validated at the boundary and stored with the battle.
 * Phase 1 supports async Song battles with per-round submissions.
 */

const minutes = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback);

export const ROUND_COUNTS = [3, 5, 7, 10] as const;
export type RoundCount = (typeof ROUND_COUNTS)[number];

export const ConstraintsSchema = z
  .object({
    eraFrom: z.number().int().min(1900).max(2100).optional(),
    eraTo: z.number().int().min(1900).max(2100).optional(),
    maxTrackLengthMs: z.number().int().min(30_000).max(30 * 60_000).optional(),
    /** Canonical genre keys (see GENRES). A pick must match one of them. */
    genres: z.array(z.enum(GENRE_KEYS)).min(1).max(3).optional(),
  })
  .strict()
  .refine((c) => c.eraFrom === undefined || c.eraTo === undefined || c.eraFrom <= c.eraTo, {
    message: "eraFrom must not be after eraTo",
    path: ["eraTo"],
  });

export const TRACKS_PER_ROUND = [1, 2, 3] as const;
export type TracksPerRound = (typeof TRACKS_PER_ROUND)[number];

/**
 * Who decides a round:
 *  - CROWD: listener votes only.
 *  - AI: the AI judge only (listeners can listen but not vote).
 *  - COMBINED: one score; the AI's pick counts for `aiWeightPercent` of the round.
 *  - SEPARATE: two scorecards, crowd and AI, each with its own winner. The crowd's card is official.
 */
export const JUDGING_MODES = ["CROWD", "AI", "COMBINED", "SEPARATE"] as const;
export type JudgingMode = (typeof JUDGING_MODES)[number];

export const JudgingSchema = z
  .object({
    mode: z.enum(JUDGING_MODES).default("CROWD"),
    aiWeightPercent: z.number().int().min(10).max(90).default(30),
  })
  .strict();

export const usesAiJudge = (mode: JudgingMode) => mode !== "CROWD";
export const usesCrowd = (mode: JudgingMode) => mode !== "AI";

export const BattleRulesSchema = z
  .object({
    roundCount: z
      .number()
      .int()
      .refine((n): n is RoundCount => (ROUND_COUNTS as readonly number[]).includes(n), {
        message: `roundCount must be one of ${ROUND_COUNTS.join(", ")}`,
      })
      .default(5),
    /** Tracks each side plays per round; voters judge the set. */
    tracksPerRound: z
      .number()
      .int()
      .refine((n): n is TracksPerRound => (TRACKS_PER_ROUND as readonly number[]).includes(n), { message: "tracksPerRound must be 1, 2 or 3" })
      .default(1),
    judging: JudgingSchema.default({ mode: "CROWD", aiWeightPercent: 30 }),
    /** Hide which participant picked which track until the round is scored. */
    blindVoting: z.boolean().default(true),
    revealTallies: z.enum(["LIVE", "AT_ROUND_CLOSE", "AT_BATTLE_END"]).default("AT_ROUND_CLOSE"),
    timing: z
      .object({
        submissionWindowMinutes: minutes(7 * 24 * 60, 24 * 60),
        votingWindowMinutes: minutes(7 * 24 * 60, 24 * 60),
      })
      .strict()
      .default({ submissionWindowMinutes: 24 * 60, votingWindowMinutes: 24 * 60 }),
    constraints: ConstraintsSchema.optional(),
    /** Below this many votes the voting window is extended (up to maxVotingExtensions). */
    minVotesToCount: z.number().int().min(0).max(1000).default(1),
    maxVotingExtensions: z.number().int().min(0).max(3).default(1),
    /** Add one deciding round when the battle ends level. */
    suddenDeath: z.boolean().default(true),
    fairListen: z
      .object({ minPlayedMs: z.number().int().min(0).max(120_000).default(20_000) })
      .strict()
      .default({ minPlayedMs: 20_000 }),
    voterEligibility: z
      .object({
        minAccountAgeHours: z.number().int().min(0).max(720).default(0),
        requireVerifiedEmail: z.boolean().default(true),
      })
      .strict()
      .default({ minAccountAgeHours: 0, requireVerifiedEmail: true }),
    /** An unaccepted challenge expires after this long. */
    challengeExpiryHours: z.number().int().min(1).max(14 * 24).default(72),
  })
  .strict();

export type BattleRules = z.output<typeof BattleRulesSchema>;
export type BattleRulesInput = z.input<typeof BattleRulesSchema>;

export function parseRules(input: unknown): BattleRules {
  return BattleRulesSchema.parse(input ?? {});
}

export const defaultRules = (): BattleRules => parseRules({});

/** Example from the plan: "2000s R&B, 10 rounds". */
export function eraPreset(from: number, to: number, roundCount: RoundCount = 10): BattleRules {
  return parseRules({ roundCount, constraints: { eraFrom: from, eraTo: to } });
}
