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

/** Returns the winning participant, or null for a draw. */
export function roundWinner(tally: RoundTally | undefined, participantIds: readonly [string, string]): string | null {
  const [a, b] = participantIds;
  const ta = tallyFor(tally, a);
  const tb = tallyFor(tally, b);
  if (ta.weighted !== tb.weighted) return ta.weighted > tb.weighted ? a : b;
  if (ta.count !== tb.count) return ta.count > tb.count ? a : b;
  return null;
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
}

export function battleOutcome(rounds: readonly ScoredRound[], participantIds: readonly [string, string]): BattleOutcome {
  const [a, b] = participantIds;
  const roundsWon: Record<string, number> = { [a]: 0, [b]: 0 };
  const weighted: Record<string, number> = { [a]: 0, [b]: 0 };

  for (const r of rounds) {
    if (r.winnerParticipantId && r.winnerParticipantId in roundsWon) {
      roundsWon[r.winnerParticipantId] = (roundsWon[r.winnerParticipantId] ?? 0) + 1;
    }
    weighted[a] = (weighted[a] ?? 0) + tallyFor(r.tally, a).weighted;
    weighted[b] = (weighted[b] ?? 0) + tallyFor(r.tally, b).weighted;
  }

  const total = (weighted[a] ?? 0) + (weighted[b] ?? 0);
  const voteShare = {
    [a]: total ? (weighted[a] ?? 0) / total : 0,
    [b]: total ? (weighted[b] ?? 0) / total : 0,
  };

  let winnerParticipantId: string | null = null;
  const ra = roundsWon[a] ?? 0;
  const rb = roundsWon[b] ?? 0;
  if (ra !== rb) winnerParticipantId = ra > rb ? a : b;
  else if ((weighted[a] ?? 0) !== (weighted[b] ?? 0)) winnerParticipantId = (weighted[a] ?? 0) > (weighted[b] ?? 0) ? a : b;

  return { roundsWon, voteShare, winnerParticipantId };
}
