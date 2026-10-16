/**
 * Battle engine: pure state transitions for async song-for-song battles.
 *
 * The service layer loads a battle into a `BattleModel`, calls `advance()`
 * with the current time, and persists whatever changed. No I/O here, so every
 * rule is unit-testable and transitions replay deterministically.
 *
 *   OPEN / PENDING_ACCEPT ──accept──▶ IN_PROGRESS ──last round scored──▶ COMPLETE
 *            └──────── expiry / cancel ──▶ EXPIRED / CANCELLED
 *
 *   Round: SUBMISSIONS_OPEN ──both picked──▶ VOTING_OPEN ──deadline──▶ CLOSED
 *               └──deadline with a missing pick──▶ CLOSED (forfeit or void)
 */
import { type BattleRules, CHALLENGE_TTL_MS, windows } from "./rules";

export type Side = 0 | 1;
export type BattleStatus = "OPEN" | "PENDING_ACCEPT" | "IN_PROGRESS" | "COMPLETE" | "CANCELLED" | "EXPIRED";
export type RoundStatus = "SUBMISSIONS_OPEN" | "VOTING_OPEN" | "CLOSED";
export type RoundOutcome = "VOTES" | "FORFEIT" | "VOID";

export interface RoundModel {
  index: number;
  status: RoundStatus;
  suddenDeath: boolean;
  openedAt: Date;
  submissionsCloseAt: Date;
  votingClosesAt: Date | null;
  submittedSides: Side[];
  /** Live counts while voting; final counts once closed. */
  votes: [number, number];
  winnerSide: Side | null;
  outcome: RoundOutcome | null;
}

export interface BattleModel {
  status: BattleStatus;
  rules: BattleRules;
  createdAt: Date;
  expiresAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  winnerSide: Side | null;
  rounds: RoundModel[];
}

export class BattleRuleError extends Error {
  constructor(
    readonly code:
      | "NOT_ACCEPTING"
      | "EXPIRED"
      | "NOT_IN_PROGRESS"
      | "ROUND_NOT_OPEN_FOR_SUBMISSIONS"
      | "ALREADY_SUBMITTED"
      | "ROUND_NOT_OPEN_FOR_VOTING",
    message: string,
  ) {
    super(message);
    this.name = "BattleRuleError";
  }
}

export function newChallenge(rules: BattleRules, now: Date, direct: boolean): BattleModel {
  return {
    status: direct ? "PENDING_ACCEPT" : "OPEN",
    rules,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
    startedAt: null,
    endedAt: null,
    winnerSide: null,
    rounds: [],
  };
}

export function accept(battle: BattleModel, now: Date): BattleModel {
  const b = advance(battle, now);
  if (b.status === "EXPIRED") throw new BattleRuleError("EXPIRED", "This challenge has expired.");
  if (b.status !== "OPEN" && b.status !== "PENDING_ACCEPT") {
    throw new BattleRuleError("NOT_ACCEPTING", "This battle isn't waiting for an opponent.");
  }
  return { ...b, status: "IN_PROGRESS", startedAt: now, rounds: [openRound(b, 0, now, false)] };
}

export function cancel(battle: BattleModel, now: Date): BattleModel {
  const b = advance(battle, now);
  if (b.status !== "OPEN" && b.status !== "PENDING_ACCEPT") {
    throw new BattleRuleError("NOT_ACCEPTING", "Only challenges that haven't started can be cancelled.");
  }
  return { ...b, status: "CANCELLED", endedAt: now };
}

/**
 * Records one side's pick for `roundIndex`, which must be the current round
 * (a pick made for a round that has since closed must not land in the next
 * one). Opens voting once both sides have picked.
 */
export function submit(battle: BattleModel, side: Side, roundIndex: number, now: Date): BattleModel {
  const b = advance(battle, now);
  if (b.status !== "IN_PROGRESS") throw new BattleRuleError("NOT_IN_PROGRESS", "This battle isn't in progress.");
  const round = current(b);
  if (!round || round.index !== roundIndex || round.status !== "SUBMISSIONS_OPEN") {
    throw new BattleRuleError("ROUND_NOT_OPEN_FOR_SUBMISSIONS", "Picks for this round are closed.");
  }
  if (round.submittedSides.includes(side)) {
    throw new BattleRuleError("ALREADY_SUBMITTED", "You've already picked a track for this round.");
  }
  const submittedSides = [...round.submittedSides, side];
  const updated: RoundModel =
    submittedSides.length === 2
      ? {
          ...round,
          submittedSides,
          status: "VOTING_OPEN",
          votingClosesAt: new Date(now.getTime() + windows(b.rules).votingWindowMs),
        }
      : { ...round, submittedSides };
  return replaceRound(b, updated);
}

/** Throws unless the current round accepts votes at `now`. */
export function assertVotingOpen(battle: BattleModel, roundIndex: number, now: Date): void {
  const b = advance(battle, now);
  const round = current(b);
  if (b.status !== "IN_PROGRESS" || !round || round.index !== roundIndex || round.status !== "VOTING_OPEN") {
    throw new BattleRuleError("ROUND_NOT_OPEN_FOR_VOTING", "Voting for this round has closed.");
  }
}

/**
 * Applies every transition that is due at `now`: expiries, missed pick
 * deadlines, closed votes, new rounds, sudden death and the final result.
 * Each step happens at the moment it became due, so a battle nobody looked
 * at for days still ends up with the same timeline as one watched live.
 */
export function advance(battle: BattleModel, now: Date): BattleModel {
  let b = battle;
  for (let guard = 0; guard < 64; guard++) {
    const next = step(b, now);
    if (next === b) return b;
    b = next;
  }
  throw new Error("Battle did not settle; transition loop guard hit");
}

function step(b: BattleModel, now: Date): BattleModel {
  if ((b.status === "OPEN" || b.status === "PENDING_ACCEPT") && now >= b.expiresAt) {
    return { ...b, status: "EXPIRED", endedAt: b.expiresAt };
  }
  if (b.status !== "IN_PROGRESS") return b;

  const round = current(b);
  if (!round) return b;

  if (round.status === "SUBMISSIONS_OPEN" && now >= round.submissionsCloseAt) {
    const at = round.submissionsCloseAt;
    const [only] = round.submittedSides;
    const closed: RoundModel =
      round.submittedSides.length === 1 && only !== undefined
        ? { ...round, status: "CLOSED", winnerSide: only, outcome: "FORFEIT" }
        : { ...round, status: "CLOSED", winnerSide: null, outcome: "VOID" };
    return afterRoundClosed(replaceRound(b, closed), at);
  }

  if (round.status === "VOTING_OPEN" && round.votingClosesAt && now >= round.votingClosesAt) {
    const [v0, v1] = round.votes;
    const winnerSide: Side | null = v0 > v1 ? 0 : v1 > v0 ? 1 : null;
    const closed: RoundModel = { ...round, status: "CLOSED", winnerSide, outcome: "VOTES" };
    return afterRoundClosed(replaceRound(b, closed), round.votingClosesAt);
  }

  return b;
}

function afterRoundClosed(b: BattleModel, at: Date): BattleModel {
  const regular = b.rounds.filter((r) => !r.suddenDeath);
  if (regular.length < b.rules.roundCount) {
    return { ...b, rounds: [...b.rounds, openRound(b, b.rounds.length, at, false)] };
  }

  const score = scoreboard(b);
  if (score.roundsWon[0] !== score.roundsWon[1]) return finish(b, score.roundsWon[0] > score.roundsWon[1] ? 0 : 1, at);

  // Level on rounds: one sudden-death round, then total votes, then a draw.
  const suddenDeath = b.rounds.find((r) => r.suddenDeath);
  if (!suddenDeath) return { ...b, rounds: [...b.rounds, openRound(b, b.rounds.length, at, true)] };
  if (suddenDeath.winnerSide !== null) return finish(b, suddenDeath.winnerSide, at);
  const [t0, t1] = score.totalVotes;
  return finish(b, t0 > t1 ? 0 : t1 > t0 ? 1 : null, at);
}

function finish(b: BattleModel, winnerSide: Side | null, at: Date): BattleModel {
  return { ...b, status: "COMPLETE", winnerSide, endedAt: at };
}

function openRound(b: BattleModel, index: number, at: Date, suddenDeath: boolean): RoundModel {
  return {
    index,
    status: "SUBMISSIONS_OPEN",
    suddenDeath,
    openedAt: at,
    submissionsCloseAt: new Date(at.getTime() + windows(b.rules).submissionWindowMs),
    votingClosesAt: null,
    submittedSides: [],
    votes: [0, 0],
    winnerSide: null,
    outcome: null,
  };
}

export function current(b: BattleModel): RoundModel | undefined {
  return b.rounds.at(-1);
}

function replaceRound(b: BattleModel, round: RoundModel): BattleModel {
  return { ...b, rounds: b.rounds.map((r) => (r.index === round.index ? round : r)) };
}

/** Rounds won (sudden death excluded) and votes across closed rounds, per side. */
export function scoreboard(b: Pick<BattleModel, "rounds">): { roundsWon: [number, number]; totalVotes: [number, number] } {
  const roundsWon: [number, number] = [0, 0];
  const totalVotes: [number, number] = [0, 0];
  for (const r of b.rounds) {
    if (r.status !== "CLOSED") continue;
    if (r.winnerSide !== null && !r.suddenDeath) roundsWon[r.winnerSide]++;
    totalVotes[0] += r.votes[0];
    totalVotes[1] += r.votes[1];
  }
  return { roundsWon, totalVotes };
}
