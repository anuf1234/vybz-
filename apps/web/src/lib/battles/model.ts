import {
  type BattleModel,
  type BattleRules,
  BattleRulesSchema,
  type RoundModel,
  type Side,
  current,
} from "@vybz/core";
import type { Prisma, PrismaClient } from "@vybz/db";

/** Prisma client or an interactive transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;

const battleInclude = {
  rounds: { orderBy: { index: "asc" }, include: { submissions: { select: { side: true } } } },
  participants: true,
} as const;

export type BattleRow = Prisma.BattleGetPayload<{ include: typeof battleInclude }>;

/** Locks the battle row for the rest of the transaction, then loads it as an engine model. */
export async function lockBattle(tx: Prisma.TransactionClient, battleId: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM battles WHERE id = ${battleId} FOR UPDATE`;
  if (locked.length === 0) return null;
  const row = await tx.battle.findUniqueOrThrow({ where: { id: battleId }, include: battleInclude });

  const voting = row.rounds.find((r) => r.status === "VOTING_OPEN");
  const live: [number, number] = [0, 0];
  if (voting) {
    const counts = await tx.vote.groupBy({ by: ["side"], where: { roundId: voting.id }, _count: { _all: true } });
    for (const c of counts) live[c.side as Side] = c._count._all;
  }
  return { row, model: toModel(row, voting?.id ?? null, live) };
}

export function parseRules(json: Prisma.JsonValue): BattleRules {
  return BattleRulesSchema.parse(json);
}

function toModel(row: BattleRow, votingRoundId: string | null, live: [number, number]): BattleModel {
  return {
    status: row.status,
    rules: parseRules(row.rules),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    winnerSide: (row.winnerSide as Side | null) ?? null,
    rounds: row.rounds.map(
      (r): RoundModel => ({
        index: r.index,
        status: r.status,
        suddenDeath: r.suddenDeath,
        openedAt: r.openedAt,
        submissionsCloseAt: r.submissionsCloseAt,
        votingClosesAt: r.votingClosesAt,
        submittedSides: r.submissions.map((s) => s.side as Side),
        votes: r.id === votingRoundId ? live : [r.votes0, r.votes1],
        winnerSide: (r.winnerSide as Side | null) ?? null,
        outcome: r.outcome,
      }),
    ),
  };
}

/** The next moment this battle needs advancing, for the deadline sweep. */
export function nextDeadline(b: BattleModel): Date | null {
  if (b.status === "OPEN" || b.status === "PENDING_ACCEPT") return b.expiresAt;
  if (b.status !== "IN_PROGRESS") return null;
  const r = current(b);
  if (!r) return null;
  return r.status === "SUBMISSIONS_OPEN" ? r.submissionsCloseAt : r.votingClosesAt;
}

/** Writes an advanced model back: battle fields, changed rounds, new rounds. */
export async function persist(tx: Prisma.TransactionClient, row: BattleRow, model: BattleModel): Promise<void> {
  await tx.battle.update({
    where: { id: row.id },
    data: {
      status: model.status,
      startedAt: model.startedAt,
      endedAt: model.endedAt,
      winnerSide: model.winnerSide,
      nextDeadline: nextDeadline(model),
    },
  });

  for (const r of model.rounds) {
    const existing = row.rounds.find((x) => x.index === r.index);
    const fields = {
      status: r.status,
      votingClosesAt: r.votingClosesAt,
      winnerSide: r.winnerSide,
      outcome: r.outcome,
      // Final counts are frozen when a round closes; live counts stay in `votes`.
      ...(r.status === "CLOSED" ? { votes0: r.votes[0], votes1: r.votes[1] } : {}),
    };
    if (existing) {
      const changed =
        existing.status !== r.status ||
        existing.votingClosesAt?.getTime() !== r.votingClosesAt?.getTime() ||
        existing.winnerSide !== r.winnerSide ||
        existing.outcome !== r.outcome;
      if (changed) await tx.battleRound.update({ where: { id: existing.id }, data: fields });
    } else {
      await tx.battleRound.create({
        data: {
          battleId: row.id,
          index: r.index,
          suddenDeath: r.suddenDeath,
          openedAt: r.openedAt,
          submissionsCloseAt: r.submissionsCloseAt,
          ...fields,
        },
      });
    }
  }
}
