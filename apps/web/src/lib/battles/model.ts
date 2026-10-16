import { type BattleState, type Side, type Transition, nextDeadline, tally } from "@vybz/core";
import type { Prisma } from "@vybz/db";
import { awardXP, grantBadge } from "../progression";

type Tx = Prisma.TransactionClient;

const lockInclude = {
  participants: { select: { id: true, userId: true, side: true, lineupLockedAt: true } },
} as const;

export type LockedBattle = Prisma.BattleGetPayload<{ include: typeof lockInclude }>;

/** Locks the battle row for the rest of the transaction and loads it. */
export async function lockBattle(tx: Tx, battleId: string): Promise<LockedBattle | null> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM battles WHERE id = ${battleId} FOR UPDATE`;
  if (locked.length === 0) return null;
  return tx.battle.findUniqueOrThrow({ where: { id: battleId }, include: lockInclude });
}

export function toState(b: LockedBattle): BattleState {
  const lockedSide = (s: Side) => Boolean(b.participants.find((p) => p.side === s)?.lineupLockedAt);
  return {
    status: b.status,
    type: b.type,
    roundCount: b.roundCount,
    votingDurationMs: b.votingDurationMs,
    revealIntervalMs: b.revealIntervalMs,
    scheduledFor: b.scheduledFor,
    sentAt: b.sentAt,
    expiresAt: b.expiresAt,
    acceptedAt: b.acceptedAt,
    lineupDueAt: b.lineupDueAt,
    startsAt: b.startsAt,
    votingEndsAt: b.votingEndsAt,
    completedAt: b.completedAt,
    cancelledAt: b.cancelledAt,
    cancelReason: b.cancelReason,
    lineupLocked: [lockedSide(0), lockedSide(1)],
  };
}

/**
 * Writes a new state back, logs each transition, and runs the side effects a
 * transition owns (results, XP, notifications). Lineup locks are written by
 * the caller, which knows which participant locked.
 */
export async function persist(
  tx: Tx,
  battle: LockedBattle,
  state: BattleState,
  transitions: Transition[],
  actorId: string | null = null,
): Promise<void> {
  // Results first: the database only accepts COMPLETED with final scores in place.
  if (transitions.some((t) => t.to === "COMPLETED")) await finalize(tx, battle);
  await tx.battle.update({
    where: { id: battle.id },
    data: {
      status: state.status,
      sentAt: state.sentAt,
      expiresAt: state.expiresAt,
      acceptedAt: state.acceptedAt,
      lineupDueAt: state.lineupDueAt,
      startsAt: state.startsAt,
      votingEndsAt: state.votingEndsAt,
      completedAt: state.completedAt,
      cancelledAt: state.cancelledAt,
      cancelReason: state.cancelReason,
      nextDeadline: nextDeadline(state),
    },
  });
  if (transitions.length > 0) {
    await tx.battleEvent.createMany({
      data: transitions.map((t) => ({
        battleId: battle.id,
        kind: `${t.from}->${t.to}`,
        actorId,
        createdAt: t.at,
      })),
    });
  }
  for (const t of transitions) await onTransition(tx, battle, t);
}

async function onTransition(tx: Tx, battle: LockedBattle, t: Transition): Promise<void> {
  const players = battle.participants.map((p) => p.userId);
  if (t.to === "ACTIVE") {
    await tx.notification.createMany({
      data: players.map((recipientId) => ({ recipientId, type: "BATTLE_LIVE" as const, battleId: battle.id })),
    });
  }
  if (t.to === "CANCELLED" && t.from === "ACCEPTED") {
    await tx.notification.createMany({
      data: players.map((recipientId) => ({
        recipientId,
        type: "BATTLE_RESULT" as const,
        battleId: battle.id,
        data: { cancelled: "LINEUP_MISSED" },
      })),
    });
  }
}

/** Counts votes, decides rounds and the battle, and stores the result permanently. */
async function finalize(tx: Tx, battle: LockedBattle): Promise<void> {
  const rounds = await tx.battleRound.findMany({
    where: { battleId: battle.id },
    select: { id: true, index: true, submissions: { select: { id: true, side: true } } },
    orderBy: { index: "asc" },
  });
  const counts = await tx.vote.groupBy({
    by: ["roundId", "selection"],
    where: { battleId: battle.id },
    _count: { _all: true },
  });
  const votesFor = (roundId: string, side: number) =>
    counts.find((c) => c.roundId === roundId && c.selection === side)?._count._all ?? 0;

  const result = tally(
    rounds.map((r) => ({
      index: r.index,
      votes: [votesFor(r.id, 0), votesFor(r.id, 1)],
      submissionIds: [r.submissions.find((s) => s.side === 0)?.id ?? "", r.submissions.find((s) => s.side === 1)?.id ?? ""],
    })),
  );
  const voters = await tx.vote.findMany({ where: { battleId: battle.id }, distinct: ["voterId"], select: { voterId: true } });

  for (const r of rounds) {
    const rr = result.rounds.find((x) => x.index === r.index)!;
    await tx.battleRound.update({
      where: { id: r.id },
      data: { votesA: rr.votes[0], votesB: rr.votes[1], winnerSide: rr.winnerSide },
    });
  }
  const favorite = result.crowdFavorite?.submissionId || null;
  await tx.battle.update({
    where: { id: battle.id },
    data: {
      scoreA: result.score[0],
      scoreB: result.score[1],
      winnerSide: result.winnerSide,
      totalVoters: voters.length,
      crowdFavoriteId: favorite,
    },
  });

  for (const p of battle.participants) {
    await awardXP(tx, p.userId, "BATTLE_COMPLETED", battle.id);
    await grantBadge(tx, p.userId, "FIRST_BATTLE", battle.id);
    if (result.winnerSide === p.side) {
      await awardXP(tx, p.userId, "BATTLE_WON", battle.id);
      await grantBadge(tx, p.userId, "FIRST_WIN", battle.id);
    }
    await tx.notification.create({
      data: {
        recipientId: p.userId,
        type: "BATTLE_RESULT",
        battleId: battle.id,
        data: { score: result.score, winnerSide: result.winnerSide, yourSide: p.side },
      },
    });
  }
  if (favorite) {
    const sub = await tx.battleSubmission.findUnique({ where: { id: favorite }, select: { participant: { select: { userId: true } } } });
    if (sub) {
      await awardXP(tx, sub.participant.userId, "CROWD_FAVORITE", battle.id);
      await grantBadge(tx, sub.participant.userId, "CROWD_FAVORITE", battle.id);
    }
  }
}
