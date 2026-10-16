import { prisma } from "@vybz/db";
import { AppError } from "./errors";

/**
 * Fixed-window limiter in Postgres (the rate_limits table Better Auth also
 * uses, under our own key prefix), so limits hold across serverless
 * instances. One atomic upsert per check.
 */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<{ ok: boolean; retryAfterMs: number }> {
  const now = Date.now();
  const rows = await prisma.$queryRaw<{ count: number; lastRequest: bigint }[]>`
    INSERT INTO rate_limits (id, key, count, "lastRequest")
    VALUES (${`app:${key}`}, ${`app:${key}`}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits."lastRequest" <= ${now - windowMs} THEN 1 ELSE rate_limits.count + 1 END,
      "lastRequest" = CASE WHEN rate_limits."lastRequest" <= ${now - windowMs} THEN ${now} ELSE rate_limits."lastRequest" END
    RETURNING count, "lastRequest"`;
  const row = rows[0]!;
  const ok = row.count <= max;
  return { ok, retryAfterMs: ok ? 0 : Number(row.lastRequest) + windowMs - now };
}

/** Throws RATE_LIMITED when over the limit. */
export async function enforceRateLimit(key: string, max: number, windowMs: number): Promise<void> {
  const { ok, retryAfterMs } = await rateLimit(key, max, windowMs);
  if (!ok) {
    const s = Math.max(1, Math.ceil(retryAfterMs / 1000));
    throw new AppError("RATE_LIMITED", `Slow down a little. Try again in ${s} second${s === 1 ? "" : "s"}.`);
  }
}

/** Limits used across the app. Per user unless noted. */
export const LIMITS = {
  vote: { max: 40, windowMs: 60_000 },
  listen: { max: 240, windowMs: 60_000 },
  comment: { max: 6, windowMs: 60_000 },
  reaction: { max: 60, windowMs: 60_000 },
  follow: { max: 30, windowMs: 60_000 },
  createBattle: { max: 10, windowMs: 60 * 60_000 },
  catalogSearch: { max: 60, windowMs: 60_000 },
  upload: { max: 10, windowMs: 60 * 60_000 },
} as const;
