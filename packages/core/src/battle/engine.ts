import { CHALLENGE_TTL_MS, LINEUP_WINDOW_MS, type BattleType } from "./rules";

/**
 * The battle state machine. Pure functions over plain data: the web app loads
 * a battle under a row lock, calls these, and writes the result back.
 *
 *   DRAFT ──send──▶ CHALLENGE_SENT ──accept──▶ ACCEPTED ──opponent locks lineup──▶ SCHEDULED
 *     │                 │  (expires)              │  (lineup deadline)                │ startsAt
 *     ▼                 ▼                         ▼                                   ▼
 *  CANCELLED ◀──────────┴─────────────────────────┘                                 ACTIVE
 *                                                       (rounds reveal one by one)    │ all revealed
 *                                                                                     ▼
 *                                         COMPLETED ◀──votingEndsAt── VOTING
 *
 * The challenger locks their lineup before sending, so a challenge always
 * arrives with picks in place. ACTIVE is the premiere: rounds unlock one per
 * reveal interval and can be voted on as soon as they unlock. With no
 * interval every round unlocks at once and ACTIVE passes straight to VOTING.
 * Every deadline transition happens at the deadline's own time, so lazy
 * advancement gives the same history as a perfectly punctual timer.
 */

export type Side = 0 | 1;
export type BattleStatus =
  | "DRAFT"
  | "CHALLENGE_SENT"
  | "ACCEPTED"
  | "SCHEDULED"
  | "ACTIVE"
  | "VOTING"
  | "COMPLETED"
  | "CANCELLED";
export type CancelReason = "WITHDRAWN" | "DECLINED" | "EXPIRED" | "LINEUP_MISSED" | "MODERATED";

export interface BattleState {
  status: BattleStatus;
  type: BattleType;
  roundCount: number;
  votingDurationMs: number;
  revealIntervalMs: number;
  /** Requested premiere; null = as soon as both lineups are in. */
  scheduledFor: Date | null;
  sentAt: Date | null;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  lineupDueAt: Date | null;
  startsAt: Date | null;
  votingEndsAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: CancelReason | null;
  /** Whether each side's lineup is locked. */
  lineupLocked: [boolean, boolean];
}

export interface Transition {
  from: BattleStatus;
  to: BattleStatus;
  at: Date;
}

export class BattleRuleError extends Error {
  constructor(
    readonly code:
      | "NOT_DRAFT"
      | "LINEUP_INCOMPLETE"
      | "NOT_ACCEPTING"
      | "EXPIRED"
      | "LINEUP_LOCKED"
      | "LINEUP_CLOSED"
      | "NOT_CANCELLABLE"
      | "ROUND_NOT_OPEN",
    message: string,
  ) {
    super(message);
    this.name = "BattleRuleError";
  }
}

const FINAL: BattleStatus[] = ["COMPLETED", "CANCELLED"];

export function isFinal(s: Pick<BattleState, "status">): boolean {
  return FINAL.includes(s.status);
}

export function newDraft(
  setup: Pick<BattleState, "type" | "roundCount" | "votingDurationMs" | "revealIntervalMs" | "scheduledFor">,
): BattleState {
  return {
    ...setup,
    status: "DRAFT",
    sentAt: null,
    expiresAt: null,
    acceptedAt: null,
    lineupDueAt: null,
    startsAt: null,
    votingEndsAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    lineupLocked: [false, false],
  };
}

/** Locks one side's lineup. Player A locks while drafting; player B after accepting. */
export function lockLineup(s: BattleState, side: Side, now: Date): BattleState {
  if (s.lineupLocked[side]) throw new BattleRuleError("LINEUP_LOCKED", "That lineup is already locked in.");
  if (side === 0 && s.status !== "DRAFT") throw new BattleRuleError("NOT_DRAFT", "This battle has already been sent.");
  if (side === 1) {
    if (s.status !== "ACCEPTED") throw new BattleRuleError("LINEUP_CLOSED", "You can't change picks now.");
    if (s.lineupDueAt && now >= s.lineupDueAt) throw new BattleRuleError("LINEUP_CLOSED", "The time to pick has run out.");
  }
  const locked: [boolean, boolean] = side === 0 ? [true, s.lineupLocked[1]] : [s.lineupLocked[0], true];
  const next = { ...s, lineupLocked: locked };
  return side === 1 ? schedule(next, now) : next;
}

/** Sends a drafted challenge. The challenger's picks must already be locked. */
export function send(s: BattleState, now: Date): BattleState {
  if (s.status !== "DRAFT") throw new BattleRuleError("NOT_DRAFT", "This battle has already been sent.");
  if (!s.lineupLocked[0]) throw new BattleRuleError("LINEUP_INCOMPLETE", "Pick your songs before you send the challenge.");
  return { ...s, status: "CHALLENGE_SENT", sentAt: now, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS) };
}

export function accept(s: BattleState, now: Date): BattleState {
  if (s.status !== "CHALLENGE_SENT") throw new BattleRuleError("NOT_ACCEPTING", "This challenge isn't open anymore.");
  if (s.expiresAt && now >= s.expiresAt) throw new BattleRuleError("EXPIRED", "This challenge has expired.");
  return { ...s, status: "ACCEPTED", acceptedAt: now, lineupDueAt: new Date(now.getTime() + LINEUP_WINDOW_MS) };
}

/** Withdraw (creator), decline (invited opponent) or moderate. Only before the battle goes live, except for moderators. */
export function cancel(s: BattleState, reason: CancelReason, now: Date): BattleState {
  const before: BattleStatus[] = ["DRAFT", "CHALLENGE_SENT", "ACCEPTED"];
  const allowed = reason === "MODERATED" ? !isFinal(s) : before.includes(s.status);
  if (!allowed) throw new BattleRuleError("NOT_CANCELLABLE", "This battle can't be called off now.");
  return { ...s, status: "CANCELLED", cancelledAt: now, cancelReason: reason };
}

function schedule(s: BattleState, now: Date): BattleState {
  const start = s.scheduledFor && s.scheduledFor > now ? s.scheduledFor : now;
  return {
    ...s,
    status: "SCHEDULED",
    startsAt: start,
    votingEndsAt: new Date(allRevealedAt({ ...s, startsAt: start }).getTime() + s.votingDurationMs),
  };
}

function allRevealedAt(s: Pick<BattleState, "startsAt" | "roundCount" | "revealIntervalMs">): Date {
  return new Date(s.startsAt!.getTime() + Math.max(0, s.roundCount - 1) * s.revealIntervalMs);
}

/** Applies every transition whose time has come, each at its own deadline. */
export function advance(s: BattleState, now: Date): { state: BattleState; transitions: Transition[] } {
  const transitions: Transition[] = [];
  let cur = s;
  for (;;) {
    const due = nextDeadline(cur);
    if (!due || due > now) break;
    const from = cur.status;
    switch (cur.status) {
      case "CHALLENGE_SENT":
        cur = { ...cur, status: "CANCELLED", cancelledAt: due, cancelReason: "EXPIRED" };
        break;
      case "ACCEPTED":
        cur = { ...cur, status: "CANCELLED", cancelledAt: due, cancelReason: "LINEUP_MISSED" };
        break;
      case "SCHEDULED":
        cur = { ...cur, status: "ACTIVE" };
        break;
      case "ACTIVE":
        cur = { ...cur, status: "VOTING" };
        break;
      case "VOTING":
        cur = { ...cur, status: "COMPLETED", completedAt: due };
        break;
      default:
        return { state: cur, transitions };
    }
    transitions.push({ from, to: cur.status, at: due });
  }
  return { state: cur, transitions };
}

/** When this battle next changes state on its own, or null. */
export function nextDeadline(s: BattleState): Date | null {
  switch (s.status) {
    case "CHALLENGE_SENT":
      return s.expiresAt;
    case "ACCEPTED":
      return s.lineupDueAt;
    case "SCHEDULED":
      return s.startsAt;
    case "ACTIVE":
      return allRevealedAt(s);
    case "VOTING":
      return s.votingEndsAt;
    default:
      return null;
  }
}

/** How many rounds are unlocked (playable and, while voting is open, votable). */
export function revealedRounds(s: BattleState, now: Date): number {
  if (s.status === "COMPLETED") return s.roundCount;
  if ((s.status !== "ACTIVE" && s.status !== "VOTING") || !s.startsAt) return 0;
  if (s.revealIntervalMs === 0) return s.roundCount;
  const elapsed = now.getTime() - s.startsAt.getTime();
  return Math.min(s.roundCount, Math.floor(elapsed / s.revealIntervalMs) + 1);
}

/** When the given round unlocks (null before the battle is scheduled). */
export function roundRevealAt(s: BattleState, roundIndex: number): Date | null {
  if (!s.startsAt) return null;
  return new Date(s.startsAt.getTime() + roundIndex * s.revealIntervalMs);
}

/** Throws unless a vote on this round is allowed right now. Call after `advance`. */
export function assertRoundVotable(s: BattleState, roundIndex: number, now: Date): void {
  const open = (s.status === "ACTIVE" || s.status === "VOTING") && s.votingEndsAt !== null && now < s.votingEndsAt;
  if (!open || roundIndex < 0 || roundIndex >= revealedRounds(s, now)) {
    throw new BattleRuleError("ROUND_NOT_OPEN", "Voting isn't open for this round.");
  }
}

export interface RoundTally {
  index: number;
  votes: [number, number];
  /** Submission ids for side A and B. */
  submissionIds: [string, string];
}

export interface BattleResult {
  rounds: { index: number; votes: [number, number]; winnerSide: Side | null }[];
  score: [number, number];
  totalVotes: [number, number];
  winnerSide: Side | null;
  /** The single pick with the most votes in any round (earliest round on ties). */
  crowdFavorite: { submissionId: string; votes: number } | null;
}

/**
 * Final scoring. Each round goes to the side with more votes (a tie is a
 * drawn round). Most rounds wins the battle; level on rounds goes to total
 * votes; level on both is a draw.
 */
export function tally(rounds: RoundTally[]): BattleResult {
  const score: [number, number] = [0, 0];
  const totalVotes: [number, number] = [0, 0];
  let crowdFavorite: BattleResult["crowdFavorite"] = null;
  const out = [...rounds]
    .sort((a, b) => a.index - b.index)
    .map((r) => {
      const [a, b] = r.votes;
      const winnerSide: Side | null = a > b ? 0 : b > a ? 1 : null;
      if (winnerSide !== null) score[winnerSide]++;
      totalVotes[0] += a;
      totalVotes[1] += b;
      for (const side of [0, 1] as const) {
        const v = r.votes[side];
        if (v > 0 && (!crowdFavorite || v > crowdFavorite.votes)) {
          crowdFavorite = { submissionId: r.submissionIds[side], votes: v };
        }
      }
      return { index: r.index, votes: r.votes, winnerSide };
    });
  const winnerSide: Side | null =
    score[0] !== score[1]
      ? score[0] > score[1]
        ? 0
        : 1
      : totalVotes[0] !== totalVotes[1]
        ? totalVotes[0] > totalVotes[1]
          ? 0
          : 1
        : null;
  return { rounds: out, score, totalVotes, winnerSide, crowdFavorite };
}
