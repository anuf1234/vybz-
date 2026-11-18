import { GENRE_KEYS, ONBOARDING_BONUS, type OnboardingState } from "@vybz/core";
import { and, eq, isNotNull, schema, sql } from "@vybz/db";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { grant, systemIds } from "./progression";

/**
 * The first-run path: pick your genres, play a quick battle, then do today's
 * trivia. Steps are read from what people actually did, so a battle started
 * from anywhere counts. Finishing pays a one-time welcome bonus.
 */

async function stepsFor(deps: BattleDeps, userId: string): Promise<{ battle: boolean; trivia: boolean }> {
  const [battle] = await deps.db.select({ id: schema.battleParticipant.id }).from(schema.battleParticipant).where(eq(schema.battleParticipant.userId, userId)).limit(1);
  const [trivia] = await deps.db
    .select({ id: schema.triviaPlay.id })
    .from(schema.triviaPlay)
    .where(and(eq(schema.triviaPlay.userId, userId), isNotNull(schema.triviaPlay.finishedAt)))
    .limit(1);
  return { battle: !!battle, trivia: !!trivia };
}

async function progressRow(deps: BattleDeps, userId: string) {
  const p = schema.userProgress;
  await deps.db.insert(p).values({ userId }).onConflictDoNothing();
  const [row] = await deps.db.select().from(p).where(eq(p.userId, userId));
  return row!;
}

export async function onboardingState(deps: BattleDeps, viewer: UserRow | null): Promise<OnboardingState> {
  if (!viewer) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  const row = await progressRow(deps, viewer.id);
  const steps = await stepsFor(deps, viewer.id);
  const botAvailable = !!deps.aiJudge;
  const finished = !!row.onboardedAt;
  let bonus: OnboardingState["bonus"] = null;
  // Both steps done: finish (and pay) once.
  if (!finished && !row.onboardingSkipped && steps.battle && steps.trivia) {
    const [done] = await deps.db
      .update(schema.userProgress)
      .set({ onboardedAt: new Date() })
      .where(and(eq(schema.userProgress.userId, viewer.id), sql`${schema.userProgress.onboardedAt} is null`))
      .returning();
    if (done && !(await systemIds(deps.db, [viewer.id])).size) {
      await grant(deps.db, viewer.id, "ONBOARDING", "welcome", ONBOARDING_BONUS);
      bonus = ONBOARDING_BONUS;
    }
    return { active: false, genres: row.favoriteGenres, steps, next: null, done: true, bonus, botAvailable };
  }
  const active = !finished && !row.onboardingSkipped;
  const next = !active ? null : !row.favoriteGenres.length ? "genres" : !steps.battle ? "battle" : !steps.trivia ? "trivia" : null;
  return { active, genres: row.favoriteGenres, steps, next, done: finished, bonus, botAvailable };
}

/** { genres: [...] } saves your picks; { action: "skip" } hides the path for good. */
export async function updateOnboarding(deps: BattleDeps, viewer: UserRow | null, body: unknown): Promise<OnboardingState> {
  if (!viewer) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  const b = (body ?? {}) as { genres?: unknown; action?: unknown };
  await progressRow(deps, viewer.id);
  if (b.genres !== undefined) {
    const genres = Array.isArray(b.genres) ? [...new Set(b.genres.filter((g): g is string => typeof g === "string" && (GENRE_KEYS as string[]).includes(g)))] : [];
    if (!genres.length || genres.length > 3) throw new ServiceError(400, "INVALID_GENRES", "Pick one to three genres.");
    await deps.db.update(schema.userProgress).set({ favoriteGenres: genres }).where(eq(schema.userProgress.userId, viewer.id));
  }
  if (b.action === "skip") {
    await deps.db.update(schema.userProgress).set({ onboardingSkipped: true }).where(eq(schema.userProgress.userId, viewer.id));
  } else if (b.action !== undefined) {
    throw new ServiceError(400, "INVALID_ACTION");
  }
  return onboardingState(deps, viewer);
}
