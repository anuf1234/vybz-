import { z } from "zod";

const HOUR = 60 * 60 * 1000;

/** Timing presets shown in the create form. Custom windows can come later. */
export const PACE_PRESETS = {
  QUICK: { label: "Quick", submissionWindowMs: 1 * HOUR, votingWindowMs: 1 * HOUR },
  STANDARD: { label: "Standard", submissionWindowMs: 24 * HOUR, votingWindowMs: 24 * HOUR },
  RELAXED: { label: "Relaxed", submissionWindowMs: 48 * HOUR, votingWindowMs: 48 * HOUR },
} as const;
export type Pace = keyof typeof PACE_PRESETS;

/** How long an open or direct challenge waits for an opponent. */
export const CHALLENGE_TTL_MS = 72 * HOUR;

/** Each submission must be heard for this long (or to its end) before a vote counts. */
export const MIN_LISTEN_MS = 20_000;

const currentYear = new Date().getUTCFullYear();

export const BattleRulesSchema = z
  .object({
    roundCount: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(10)]),
    pace: z.enum(["QUICK", "STANDARD", "RELAXED"]),
    eraFrom: z.number().int().min(1900).max(currentYear).nullable(),
    eraTo: z.number().int().min(1900).max(currentYear).nullable(),
  })
  .refine((r) => r.eraFrom === null || r.eraTo === null || r.eraFrom <= r.eraTo, {
    message: "The era must start before it ends.",
    path: ["eraTo"],
  });

export type BattleRules = z.infer<typeof BattleRulesSchema>;

export const BattleThemeSchema = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, "").trim())
  .pipe(z.string().min(3, "Give the battle a theme, like “2000s R&B”.").max(60, "Keep the theme under 60 characters."));

export function windows(rules: BattleRules) {
  return PACE_PRESETS[rules.pace];
}

/** Era check against provider metadata. Unknown years are allowed; the crowd can flag them. */
export function fitsEra(rules: BattleRules, releaseYear: number | null | undefined): boolean {
  if (releaseYear == null) return true;
  if (rules.eraFrom !== null && releaseYear < rules.eraFrom) return false;
  if (rules.eraTo !== null && releaseYear > rules.eraTo) return false;
  return true;
}

export function eraLabel(rules: Pick<BattleRules, "eraFrom" | "eraTo">): string | null {
  const { eraFrom: a, eraTo: b } = rules;
  if (a === null && b === null) return null;
  if (a !== null && b !== null) return a === b ? `${a}` : `${a}–${b}`;
  return a !== null ? `${a} or later` : `${b} or earlier`;
}
