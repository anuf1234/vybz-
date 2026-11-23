import type { JudgingMode } from "./rules";

/**
 * Scoring. Pure functions over vote tallies.
 *
 * Round winner: higher weighted total, then higher raw count, else a draw.
 * Battle winner: most rounds won, then larger total weighted vote share, else level
 * (the engine then adds a sudden-death round if the rules allow).
 */

export interface SideTally {
  weighted: number;
  count: number;
}

/** participantId → tally for one round. */
export type RoundTally = Record<string, SideTally>;

const EMPTY: SideTally = { weighted: 0, count: 0 };

export function tallyFor(tally: RoundTally | undefined, participantId: string): SideTally {
  return tally?.[participantId] ?? EMPTY;
}

export function totalVotes(tally: RoundTally | undefined): number {
  return Object.values(tally ?? {}).reduce((n, t) => n + t.count, 0);
}

/** The single id with the highest value, or null if several share it. */
function uniqueMax(ids: readonly string[], value: (id: string) => number): string | null {
  let best: string | null = null;
  let bestV = -Infinity;
  let tied = false;
  for (const id of ids) {
    const v = value(id);
    if (v > bestV + 1e-9) {
      best = id;
      bestV = v;
      tied = false;
    } else if (Math.abs(v - bestV) <= 1e-9) tied = true;
  }
  return tied ? null : best;
}

/** Ids sharing the highest value. */
function maxSet(ids: readonly string[], value: (id: string) => number): string[] {
  const top = Math.max(...ids.map(value));
  return ids.filter((id) => Math.abs(value(id) - top) <= 1e-9);
}

/** Returns the winning participant, or null for a draw. Weighted votes, then raw count. */
export function roundWinner(tally: RoundTally | undefined, participantIds: readonly string[]): string | null {
  if (!participantIds.length) return null;
  const leaders = maxSet(participantIds, (id) => tallyFor(tally, id).weighted);
  if (leaders.length === 1) return leaders[0]!;
  return uniqueMax(leaders, (id) => tallyFor(tally, id).count);
}

export interface ScoredRound {
  winnerParticipantId: string | null;
  tally: RoundTally | undefined;
}

export interface BattleOutcome {
  roundsWon: Record<string, number>;
  /** Weighted share of all votes across the battle, 0..1. */
  voteShare: Record<string, number>;
  winnerParticipantId: string | null;
  /** Everyone level on rounds and vote share at the top (more than one means no winner yet). */
  leaders: string[];
}

export function battleOutcome(rounds: readonly ScoredRound[], participantIds: readonly string[]): BattleOutcome {
  const roundsWon: Record<string, number> = Object.fromEntries(participantIds.map((id) => [id, 0]));
  const weighted: Record<string, number> = Object.fromEntries(participantIds.map((id) => [id, 0]));
  for (const r of rounds) {
    if (r.winnerParticipantId && r.winnerParticipantId in roundsWon) roundsWon[r.winnerParticipantId]! += 1;
    for (const id of participantIds) weighted[id]! += tallyFor(r.tally, id).weighted;
  }
  const total = Object.values(weighted).reduce((a, b) => a + b, 0);
  const voteShare = Object.fromEntries(participantIds.map((id) => [id, total ? weighted[id]! / total : 0]));

  const onRounds = participantIds.length ? maxSet(participantIds, (id) => roundsWon[id]!) : [];
  const leaders = onRounds.length > 1 ? maxSet(onRounds, (id) => weighted[id]!) : onRounds;
  return { roundsWon, voteShare, winnerParticipantId: leaders.length === 1 ? leaders[0]! : null, leaders };
}

// ── Judging modes ──────────────────────────────────────────────────────────


export interface RoundJudgement {
  /** The official winner for the round, or null for a draw. */
  winnerParticipantId: string | null;
  /** The AI judge's pick, when the mode uses one and it ruled. */
  aiWinnerParticipantId: string | null;
  /** The crowd's own winner, when the mode uses the crowd. */
  crowdWinnerParticipantId: string | null;
}

/**
 * Decides a round under the battle's judging mode.
 * COMBINED: each side scores (1 − w) × its share of the weighted crowd vote,
 * plus w if the AI picked it. With no crowd votes the AI decides; with no AI
 * verdict the crowd does. Ties fall back to raw vote count, then a draw.
 */
export function judgeRound(
  mode: JudgingMode,
  aiWeightPercent: number,
  tally: RoundTally | undefined,
  aiPick: string | null | undefined,
  participantIds: readonly string[],
): RoundJudgement {
  const crowd = mode === "AI" ? null : roundWinner(tally, participantIds);
  const ai = aiPick && participantIds.includes(aiPick) ? aiPick : null;
  switch (mode) {
    case "CROWD":
      // With 90-second votes a round can close tied or empty: the AI judge breaks it when it's on.
      if (!crowd && ai) return { winnerParticipantId: ai, aiWinnerParticipantId: ai, crowdWinnerParticipantId: null };
      return { winnerParticipantId: crowd, aiWinnerParticipantId: null, crowdWinnerParticipantId: crowd };
    case "AI":
      return { winnerParticipantId: ai, aiWinnerParticipantId: ai, crowdWinnerParticipantId: null };
    case "SEPARATE":
      return { winnerParticipantId: crowd, aiWinnerParticipantId: ai, crowdWinnerParticipantId: crowd };
    case "COMBINED": {
      const w = aiWeightPercent / 100;
      const total = participantIds.reduce((n, id) => n + tallyFor(tally, id).weighted, 0);
      const score = (id: string) => (total ? (1 - w) * (tallyFor(tally, id).weighted / total) : 0) + (ai === id ? w : 0);
      const leaders = maxSet(participantIds, score);
      const winner = leaders.length === 1 ? leaders[0]! : uniqueMax(leaders, (id) => tallyFor(tally, id).count);
      return { winnerParticipantId: winner, aiWinnerParticipantId: ai, crowdWinnerParticipantId: crowd };
    }
  }
}
