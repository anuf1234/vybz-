import { type Streaks, boolRuns, dayRuns } from "@vybz/core";
import { type Executor, and, asc, eq, isNotNull, schema } from "@vybz/db";

/** Streaks, worked out from claims and results so they can't drift. Days are in the person's time zone. */
export async function streaksFor(db: Executor, userId: string, at = new Date()): Promise<Streaks> {
  const p = schema.battleParticipant;
  const b = schema.battle;
  const [claims, results, progress, trivia] = await Promise.all([
    db.select({ day: schema.dailyClaim.day }).from(schema.dailyClaim).where(eq(schema.dailyClaim.userId, userId)),
    db
      .select({ id: p.id, winner: b.winnerParticipantId, endedAt: b.endedAt })
      .from(p)
      .innerJoin(b, eq(b.id, p.battleId))
      .where(and(eq(p.userId, userId), eq(b.status, "COMPLETE")))
      .orderBy(asc(b.endedAt)),
    db.select({ tz: schema.userProgress.timeZone }).from(schema.userProgress).where(eq(schema.userProgress.userId, userId)),
    db
      .select({ day: schema.triviaSet.day })
      .from(schema.triviaPlay)
      .innerJoin(schema.triviaSet, eq(schema.triviaSet.id, schema.triviaPlay.setId))
      .where(and(eq(schema.triviaPlay.userId, userId), eq(schema.triviaSet.mode, "DAILY"), isNotNull(schema.triviaPlay.finishedAt))),
  ]);
  const tz = progress[0]?.tz ?? "UTC";
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = day(at);
  return {
    daily: dayRuns(
      claims.map((c) => c.day),
      today,
    ),
    wins: boolRuns(results.map((r) => r.winner === r.id)),
    play: dayRuns(
      results.flatMap((r) => (r.endedAt ? [day(r.endedAt)] : [])),
      today,
    ),
    trivia: dayRuns(
      trivia.flatMap((t) => (t.day ? [t.day] : [])),
      today,
    ),
  };
}
