import {
  type BattleAggregate,
  type RoundTally,
  nextDeadline,
  parseRules,
  standings,
} from "@vybz/core";
import { type Executor, schema, and, eq, sql } from "@vybz/db";

/**
 * Persistence for the battle aggregate. Loads a battle with its participants,
 * rounds, submissions and vote tallies, and saves an engine result back with
 * an optimistic version check.
 */

export class ConflictError extends Error {
  constructor() {
    super("battle changed concurrently");
    this.name = "ConflictError";
  }
}

export interface LoadedBattle {
  aggregate: BattleAggregate;
  row: typeof schema.battle.$inferSelect;
}

/** `lock`: "update" for state transitions, "share" for votes and listens. */
export async function loadBattle(db: Executor, id: string, lock?: "update" | "share"): Promise<LoadedBattle | null> {
  const q = db.select().from(schema.battle).where(eq(schema.battle.id, id));
  const [row] = lock === "update" ? await q.for("update") : lock === "share" ? await q.for("share") : await q;
  if (!row) return null;

  const [participants, rounds, submissions, tallies] = await Promise.all([
    db.select().from(schema.battleParticipant).where(eq(schema.battleParticipant.battleId, id)),
    db.select().from(schema.battleRound).where(eq(schema.battleRound.battleId, id)).orderBy(schema.battleRound.index),
    db.select().from(schema.submission).where(eq(schema.submission.battleId, id)),
    loadTallies(db, id),
  ]);

  const aggregate: BattleAggregate = {
    id: row.id,
    status: row.status,
    rules: parseRules(row.rules),
    creatorId: row.creatorId,
    invitedUserId: row.invitedUserId,
    acceptDeadline: row.acceptDeadline,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    winnerParticipantId: row.winnerParticipantId,
    version: row.version,
    participants: participants
      .map((p) => ({ id: p.id, userId: p.userId, side: p.side as 0 | 1 }))
      .sort((a, b) => a.side - b.side),
    rounds: rounds.map((r) => ({
      id: r.id,
      index: r.index,
      status: r.status,
      suddenDeath: r.suddenDeath,
      submissionsCloseAt: r.submissionsCloseAt,
      votingOpensAt: r.votingOpensAt,
      votingClosesAt: r.votingClosesAt,
      extensions: r.extensions,
      winnerParticipantId: r.winnerParticipantId,
      forfeitParticipantIds: r.forfeitParticipantIds,
    })),
    submissions: submissions.map((s) => ({ id: s.id, roundId: s.roundId, participantId: s.participantId, trackId: s.trackId })),
    tallies,
  };
  return { aggregate, row };
}

export async function loadTallies(db: Executor, battleId: string): Promise<Record<string, RoundTally>> {
  const rows = await db
    .select({
      roundId: schema.vote.roundId,
      participantId: schema.vote.participantId,
      weighted: sql<number>`coalesce(sum(${schema.vote.weight}) filter (where ${schema.vote.status} <> 'VOIDED'), 0)::float8`,
      count: sql<number>`(count(*) filter (where ${schema.vote.status} <> 'VOIDED'))::int`,
    })
    .from(schema.vote)
    .where(eq(schema.vote.battleId, battleId))
    .groupBy(schema.vote.roundId, schema.vote.participantId);
  const out: Record<string, RoundTally> = {};
  for (const r of rows) {
    out[r.roundId] ??= {};
    out[r.roundId]![r.participantId] = { weighted: Number(r.weighted), count: Number(r.count) };
  }
  return out;
}

export interface NewBattleFields {
  title: string;
  theme: string | null;
  rematchOfId?: string | null;
}

export async function insertBattle(db: Executor, agg: BattleAggregate, fields: NewBattleFields): Promise<void> {
  await db.insert(schema.battle).values({
    id: agg.id,
    status: agg.status,
    title: fields.title,
    theme: fields.theme,
    rules: agg.rules,
    roundCount: agg.rules.roundCount,
    creatorId: agg.creatorId,
    invitedUserId: agg.invitedUserId,
    acceptDeadline: agg.acceptDeadline,
    rematchOfId: fields.rematchOfId ?? null,
    nextDeadlineAt: nextDeadline(agg),
    version: 0,
  });
  await saveChildren(db, null, agg);
}

/**
 * Writes `after` over `before`. Throws ConflictError if someone else saved the
 * battle since `before` was loaded.
 */
export async function saveBattle(db: Executor, before: BattleAggregate, after: BattleAggregate): Promise<void> {
  const updated = await db
    .update(schema.battle)
    .set({
      status: after.status,
      acceptDeadline: after.acceptDeadline,
      startedAt: after.startedAt,
      endedAt: after.endedAt,
      winnerParticipantId: after.winnerParticipantId,
      invitedUserId: after.invitedUserId,
      nextDeadlineAt: nextDeadline(after),
      version: before.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.battle.id, before.id), eq(schema.battle.version, before.version)))
    .returning({ id: schema.battle.id });
  if (updated.length === 0) throw new ConflictError();
  await saveChildren(db, before, after);
}

async function saveChildren(db: Executor, before: BattleAggregate | null, after: BattleAggregate) {
  const roundsWon = after.participants.length === 2 ? standings(after).roundsWon : {};

  const knownParticipants = new Set(before?.participants.map((p) => p.id));
  for (const p of after.participants) {
    if (!knownParticipants.has(p.id)) {
      await db.insert(schema.battleParticipant).values({ id: p.id, battleId: after.id, userId: p.userId, side: p.side, roundsWon: roundsWon[p.id] ?? 0 });
    } else {
      await db.update(schema.battleParticipant).set({ roundsWon: roundsWon[p.id] ?? 0 }).where(eq(schema.battleParticipant.id, p.id));
    }
  }

  const prevRounds = new Map(before?.rounds.map((r) => [r.id, r]));
  for (const r of after.rounds) {
    const prev = prevRounds.get(r.id);
    if (prev && JSON.stringify(prev) === JSON.stringify(r)) continue;
    const values = {
      status: r.status,
      suddenDeath: r.suddenDeath,
      submissionsCloseAt: r.submissionsCloseAt,
      votingOpensAt: r.votingOpensAt,
      votingClosesAt: r.votingClosesAt,
      extensions: r.extensions,
      winnerParticipantId: r.winnerParticipantId,
      forfeitParticipantIds: r.forfeitParticipantIds,
    };
    if (prev) await db.update(schema.battleRound).set(values).where(eq(schema.battleRound.id, r.id));
    else await db.insert(schema.battleRound).values({ id: r.id, battleId: after.id, index: r.index, ...values });
  }

  const knownSubs = new Set(before?.submissions.map((s) => s.id));
  for (const s of after.submissions) {
    if (knownSubs.has(s.id)) continue;
    await db.insert(schema.submission).values({ id: s.id, battleId: after.id, roundId: s.roundId, participantId: s.participantId, trackId: s.trackId });
  }
}
