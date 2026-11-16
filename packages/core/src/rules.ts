import { z } from "zod";

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
  })
  .strict()
  .refine((c) => c.eraFrom === undefined || c.eraTo === undefined || c.eraFrom <= c.eraTo, {
    message: "eraFrom must not be after eraTo",
    path: ["eraTo"],
  });

export const BattleRulesSchema = z
  .object({
    roundCount: z
      .number()
      .int()
      .refine((n): n is RoundCount => (ROUND_COUNTS as readonly number[]).includes(n), {
        message: `roundCount must be one of ${ROUND_COUNTS.join(", ")}`,
      })
      .default(5),
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
