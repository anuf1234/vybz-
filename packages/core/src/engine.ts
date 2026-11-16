import { trackMatchesGenres } from "./genres";
import type { BattleRules } from "./rules";
import { type RoundTally, battleOutcome, judgeRound, totalVotes } from "./scoring";

/**
 * Battle engine: a state machine over an in-memory battle aggregate.
 *
 * No I/O. Callers load the aggregate, call one function, persist the returned
 * aggregate (with optimistic locking on `version`) and handle the events.
 * Every function returns a new aggregate; inputs are never mutated.
 */

export type BattleStatus = "OPEN_CHALLENGE" | "PENDING_ACCEPT" | "IN_PROGRESS" | "COMPLETE" | "CANCELLED" | "EXPIRED" | "VOIDED";
export type RoundStatus = "PENDING" | "SUBMISSIONS_OPEN" | "VOTING_OPEN" | "SCORED" | "VOIDED";

export const MAX_COUNTER_OFFERS = 10;

export const TERMINAL_BATTLE_STATUSES: readonly BattleStatus[] = ["COMPLETE", "CANCELLED", "EXPIRED", "VOIDED"];

export interface ParticipantState {
  id: string;
  userId: string;
  side: 0 | 1;
}

export interface RoundState {
  id: string;
  index: number;
  status: RoundStatus;
  suddenDeath: boolean;
  submissionsCloseAt: Date | null;
  votingOpensAt: Date | null;
  votingClosesAt: Date | null;
  extensions: number;
  winnerParticipantId: string | null;
  /** The AI judge's pick, recorded when the round is scored (modes that use the AI). */
  aiWinnerParticipantId: string | null;
  /** Participants who missed the submission deadline for this round. */
  forfeitParticipantIds: string[];
}

export interface SubmissionState {
  id: string;
  roundId: string;
  participantId: string;
  trackId: string;
  /** Order within the side's set for the round (0-based). */
  position: number;
}

export interface BattleAggregate {
  id: string;
  status: BattleStatus;
  rules: BattleRules;
  creatorId: string;
  /** The challenger. Null while an open challenge has no taker. */
  invitedUserId: string | null;
  /** Who proposed the current terms; the other side accepts or counters. */
  proposedByUserId: string;
  /** Terms before the latest counter-offer, so the app can show what changed. */
  previousRules: BattleRules | null;
  counterCount: number;
  acceptDeadline: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  winnerParticipantId: string | null;
  version: number;
  participants: ParticipantState[];
  rounds: RoundState[];
  submissions: SubmissionState[];
  /** roundId → tally. Supplied by the caller from the votes table. */
  tallies: Record<string, RoundTally>;
  /** roundId → participant the AI judge picked. Supplied by the caller. */
  aiVerdicts: Record<string, string>;
}

export interface EngineContext {
  now: Date;
  newId: () => string;
}

export type DomainEvent =
  | { type: "battle.created"; battleId: string }
  | { type: "battle.accepted"; battleId: string; userId: string }
  | { type: "battle.countered"; battleId: string; userId: string }
  | { type: "battle.cancelled"; battleId: string }
  | { type: "battle.expired"; battleId: string }
  | { type: "round.submissions_opened"; battleId: string; roundIndex: number; closesAt: Date }
  | { type: "round.submitted"; battleId: string; roundIndex: number; participantId: string }
  | { type: "round.voting_opened"; battleId: string; roundIndex: number; closesAt: Date }
  | { type: "round.voting_extended"; battleId: string; roundIndex: number; closesAt: Date }
  | { type: "round.scored"; battleId: string; roundIndex: number; winnerParticipantId: string | null }
  | { type: "round.sudden_death_added"; battleId: string; roundIndex: number }
  | { type: "battle.completed"; battleId: string; winnerParticipantId: string | null };

export interface EngineResult {
  battle: BattleAggregate;
  events: DomainEvent[];
}

export type EngineErrorCode =
  | "NOT_OPEN"
  | "NOT_INVITED"
  | "OWN_BATTLE"
  | "NOT_CREATOR"
  | "NOT_PARTICIPANT"
  | "NOT_IN_PROGRESS"
  | "ROUND_NOT_CURRENT"
  | "ROUND_NOT_ACCEPTING_SUBMISSIONS"
  | "ALREADY_SUBMITTED"
  | "TRACK_ALREADY_USED"
  | "TRACK_OUTSIDE_ERA"
  | "TRACK_TOO_LONG"
  | "TRACK_YEAR_UNKNOWN"
  | "TRACK_OUTSIDE_GENRE"
  | "WRONG_TRACK_COUNT"
  | "DUPLICATE_TRACK"
  | "NOT_YOUR_TURN"
  | "NO_CHANGES"
  | "TOO_MANY_COUNTERS";

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "EngineError";
  }
}

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

// ── Creation and acceptance ────────────────────────────────────────────────

export interface CreateBattleInput {
  id?: string;
  creatorId: string;
  invitedUserId?: string | null;
  rules: BattleRules;
}

export function createBattle(input: CreateBattleInput, ctx: EngineContext): EngineResult {
  if (input.invitedUserId && input.invitedUserId === input.creatorId) throw new EngineError("OWN_BATTLE");
  const id = input.id ?? ctx.newId();
  const rounds: RoundState[] = Array.from({ length: input.rules.roundCount }, (_, index) => newRound(ctx, index, false));
  const battle: BattleAggregate = {
    id,
    status: input.invitedUserId ? "PENDING_ACCEPT" : "OPEN_CHALLENGE",
    rules: input.rules,
    creatorId: input.creatorId,
    invitedUserId: input.invitedUserId ?? null,
    proposedByUserId: input.creatorId,
    previousRules: null,
    counterCount: 0,
    acceptDeadline: addHours(ctx.now, input.rules.challengeExpiryHours),
    startedAt: null,
    endedAt: null,
    winnerParticipantId: null,
    version: 0,
    participants: [{ id: ctx.newId(), userId: input.creatorId, side: 0 }],
    rounds,
    submissions: [],
    tallies: {},
    aiVerdicts: {},
  };
  return { battle, events: [{ type: "battle.created", battleId: id }] };
}

/**
 * Who must answer the current terms: for a direct challenge, whoever didn't
 * propose them. Null for an open challenge (anyone but the creator may answer).
 */
export function awaitingResponseFrom(battle: BattleAggregate): string | null {
  if (battle.status !== "PENDING_ACCEPT") return null;
  return battle.proposedByUserId === battle.creatorId ? battle.invitedUserId : battle.creatorId;
}

/** Can `userId` accept or counter the current terms right now? */
export function canRespond(battle: BattleAggregate, userId: string, now: Date): boolean {
  if (battle.acceptDeadline && now >= battle.acceptDeadline) return false;
  if (battle.status === "OPEN_CHALLENGE") return userId !== battle.creatorId;
  return battle.status === "PENDING_ACCEPT" && awaitingResponseFrom(battle) === userId;
}

function assertCanRespond(b: BattleAggregate, userId: string, now: Date) {
  if (b.status !== "OPEN_CHALLENGE" && b.status !== "PENDING_ACCEPT") throw new EngineError("NOT_OPEN");
  if (b.acceptDeadline && now >= b.acceptDeadline) throw new EngineError("NOT_OPEN", "challenge expired");
  if (b.status === "OPEN_CHALLENGE") {
    if (userId === b.creatorId) throw new EngineError("OWN_BATTLE");
    return;
  }
  if (userId !== b.creatorId && userId !== b.invitedUserId) throw new EngineError("NOT_INVITED");
  if (awaitingResponseFrom(b) !== userId) throw new EngineError("NOT_YOUR_TURN", "waiting for the other side to answer your terms");
}

/** Both sides have agreed to the current terms: the battle starts. */
export function acceptBattle(battle: BattleAggregate, userId: string, ctx: EngineContext): EngineResult {
  const b = clone(battle);
  assertCanRespond(b, userId, ctx.now);
  if (b.status === "OPEN_CHALLENGE") b.invitedUserId = userId;
  const challenger = b.invitedUserId!;

  b.participants.push({ id: ctx.newId(), userId: challenger, side: 1 });
  b.status = "IN_PROGRESS";
  b.startedAt = ctx.now;
  b.acceptDeadline = null;
  const events: DomainEvent[] = [{ type: "battle.accepted", battleId: b.id, userId }];
  const first = b.rounds[0];
  if (first) events.push(openSubmissions(b, first, ctx));
  return { battle: b, events };
}

/**
 * Propose different terms (rounds, tracks per round, genre, era, judging...).
 * The other side then accepts or counters again. Countering an open challenge
 * makes it a direct negotiation with the counterer.
 */
export function counterOffer(battle: BattleAggregate, userId: string, rules: BattleRules, ctx: EngineContext): EngineResult {
  const b = clone(battle);
  assertCanRespond(b, userId, ctx.now);
  if (JSON.stringify(rules) === JSON.stringify(b.rules)) throw new EngineError("NO_CHANGES", "those are the current terms");
  if (b.counterCount >= MAX_COUNTER_OFFERS) throw new EngineError("TOO_MANY_COUNTERS", "too many counter-offers; accept or walk away");

  if (b.status === "OPEN_CHALLENGE") b.invitedUserId = userId;
  b.previousRules = b.rules;
  b.rules = rules;
  b.proposedByUserId = userId;
  b.counterCount += 1;
  b.status = "PENDING_ACCEPT";
  b.acceptDeadline = addHours(ctx.now, rules.challengeExpiryHours);
  if (rules.roundCount !== b.rounds.length) {
    b.rounds = Array.from({ length: rules.roundCount }, (_, index) => b.rounds[index] ?? newRound(ctx, index, false));
  }
  return { battle: b, events: [{ type: "battle.countered", battleId: b.id, userId }] };
}

export function declineBattle(battle: BattleAggregate, userId: string): EngineResult {
  const b = clone(battle);
  if (b.status !== "PENDING_ACCEPT") throw new EngineError("NOT_OPEN");
  if (b.invitedUserId !== userId) throw new EngineError("NOT_INVITED");
  b.status = "CANCELLED";
  return { battle: b, events: [{ type: "battle.cancelled", battleId: b.id }] };
}

export function cancelBattle(battle: BattleAggregate, userId: string, ctx: EngineContext): EngineResult {
  const b = clone(battle);
  if (b.creatorId !== userId) throw new EngineError("NOT_CREATOR");
  if (b.status !== "OPEN_CHALLENGE" && b.status !== "PENDING_ACCEPT") throw new EngineError("NOT_OPEN");
  b.status = "CANCELLED";
  b.endedAt = ctx.now;
  return { battle: b, events: [{ type: "battle.cancelled", battleId: b.id }] };
}

// ── Submissions ────────────────────────────────────────────────────────────

export interface TrackFacts {
  id: string;
  releaseYear?: number | null;
  durationMs?: number | null;
  genres?: readonly string[] | null;
}

export function currentRound(battle: BattleAggregate): RoundState | null {
  if (battle.status !== "IN_PROGRESS") return null;
  return battle.rounds.find((r) => r.status === "SUBMISSIONS_OPEN" || r.status === "VOTING_OPEN") ?? null;
}

export function participantFor(battle: BattleAggregate, userId: string | null | undefined): ParticipantState | null {
  if (!userId) return null;
  return battle.participants.find((p) => p.userId === userId) ?? null;
}

export function checkTrackAllowed(rules: BattleRules, track: TrackFacts): void {
  const c = rules.constraints;
  if (!c) return;
  if (c.eraFrom !== undefined || c.eraTo !== undefined) {
    if (track.releaseYear == null) throw new EngineError("TRACK_YEAR_UNKNOWN", "this battle has an era rule and the track has no release year");
    if ((c.eraFrom !== undefined && track.releaseYear < c.eraFrom) || (c.eraTo !== undefined && track.releaseYear > c.eraTo)) {
      throw new EngineError("TRACK_OUTSIDE_ERA", `released ${track.releaseYear}, outside ${c.eraFrom ?? "…"}–${c.eraTo ?? "…"}`);
    }
  }
  if (c.genres?.length && trackMatchesGenres(track.genres, c.genres) === false) {
    throw new EngineError("TRACK_OUTSIDE_GENRE", `${(track.genres ?? []).join(", ")} isn't in this battle's genre`);
  }
  if (c.maxTrackLengthMs !== undefined && track.durationMs != null && track.durationMs > c.maxTrackLengthMs) {
    throw new EngineError("TRACK_TOO_LONG");
  }
}

export interface SubmitInput {
  userId: string;
  roundIndex: number;
  /** The side's whole set for the round: exactly `rules.tracksPerRound` tracks. */
  tracks: TrackFacts[];
  submissionIds?: string[];
}

export function submitTrack(battle: BattleAggregate, input: SubmitInput, ctx: EngineContext): EngineResult {
  const b = clone(battle);
  if (b.status !== "IN_PROGRESS") throw new EngineError("NOT_IN_PROGRESS");
  const participant = participantFor(b, input.userId);
  if (!participant) throw new EngineError("NOT_PARTICIPANT");
  const round = currentRound(b);
  if (!round || round.index !== input.roundIndex) throw new EngineError("ROUND_NOT_CURRENT");
  if (round.status !== "SUBMISSIONS_OPEN") throw new EngineError("ROUND_NOT_ACCEPTING_SUBMISSIONS");
  if (round.submissionsCloseAt && ctx.now >= round.submissionsCloseAt) throw new EngineError("ROUND_NOT_ACCEPTING_SUBMISSIONS");
  if (b.submissions.some((s) => s.roundId === round.id && s.participantId === participant.id)) {
    throw new EngineError("ALREADY_SUBMITTED");
  }
  const n = b.rules.tracksPerRound;
  if (input.tracks.length !== n) throw new EngineError("WRONG_TRACK_COUNT", `this battle plays ${n} track${n === 1 ? "" : "s"} per round`);
  if (new Set(input.tracks.map((t) => t.id)).size !== input.tracks.length) throw new EngineError("DUPLICATE_TRACK");
  for (const t of input.tracks) {
    if (b.submissions.some((s) => s.trackId === t.id)) throw new EngineError("TRACK_ALREADY_USED");
    checkTrackAllowed(b.rules, t);
  }

  input.tracks.forEach((t, position) => {
    b.submissions.push({
      id: input.submissionIds?.[position] ?? ctx.newId(),
      roundId: round.id,
      participantId: participant.id,
      trackId: t.id,
      position,
    });
  });
  const events: DomainEvent[] = [
    { type: "round.submitted", battleId: b.id, roundIndex: round.index, participantId: participant.id },
  ];
  const sides = new Set(submissionsFor(b, round.id).map((s) => s.participantId));
  if (sides.size === 2) events.push(openVoting(b, round, ctx));
  return { battle: b, events };
}

export function submissionsFor(battle: BattleAggregate, roundId: string): SubmissionState[] {
  return battle.submissions.filter((s) => s.roundId === roundId);
}

// ── Time-driven transitions ────────────────────────────────────────────────

/**
 * Applies every transition that is due at `ctx.now`. Idempotent: calling it
 * again with the same inputs changes nothing. Called on read, after writes,
 * and by the scheduler.
 */
export function advance(battle: BattleAggregate, ctx: EngineContext): EngineResult {
  const b = clone(battle);
  const events: DomainEvent[] = [];

  if ((b.status === "OPEN_CHALLENGE" || b.status === "PENDING_ACCEPT") && b.acceptDeadline && ctx.now >= b.acceptDeadline) {
    b.status = "EXPIRED";
    b.endedAt = ctx.now;
    events.push({ type: "battle.expired", battleId: b.id });
    return { battle: b, events };
  }

  // Bounded loop: each pass moves one round forward by one step.
  for (let guard = 0; guard < b.rounds.length * 4 + 4 && b.status === "IN_PROGRESS"; guard++) {
    const round = currentRound(b);
    if (!round) {
      const next = b.rounds.find((r) => r.status === "PENDING");
      if (next) {
        events.push(openSubmissions(b, next, ctx));
        continue;
      }
      events.push(...finish(b, ctx));
      continue;
    }

    if (round.status === "SUBMISSIONS_OPEN" && round.submissionsCloseAt && ctx.now >= round.submissionsCloseAt) {
      const subs = submissionsFor(b, round.id);
      const missing = b.participants.filter((p) => !subs.some((s) => s.participantId === p.id));
      round.forfeitParticipantIds = missing.map((p) => p.id);
      // One side missing: the other side takes the round. Both missing: a draw.
      const present = b.participants.filter((p) => subs.some((s) => s.participantId === p.id));
      round.winnerParticipantId = present.length === 1 ? (present[0]?.id ?? null) : null;
      round.status = "SCORED";
      events.push({ type: "round.scored", battleId: b.id, roundIndex: round.index, winnerParticipantId: round.winnerParticipantId });
      continue;
    }

    if (round.status === "VOTING_OPEN" && round.votingClosesAt && ctx.now >= round.votingClosesAt) {
      const tally = b.tallies[round.id];
      const { mode, aiWeightPercent } = b.rules.judging;
      const aiPick = b.aiVerdicts[round.id];
      const needsMore = mode === "AI" ? !aiPick : totalVotes(tally) < b.rules.minVotesToCount;
      if (needsMore && round.extensions < b.rules.maxVotingExtensions) {
        round.extensions += 1;
        round.votingClosesAt = addMinutes(ctx.now, b.rules.timing.votingWindowMinutes);
        events.push({ type: "round.voting_extended", battleId: b.id, roundIndex: round.index, closesAt: round.votingClosesAt });
        break;
      }
      const judged = judgeRound(mode, aiWeightPercent, tally, aiPick, participantIds(b));
      round.winnerParticipantId = judged.winnerParticipantId;
      round.aiWinnerParticipantId = judged.aiWinnerParticipantId;
      round.status = "SCORED";
      events.push({ type: "round.scored", battleId: b.id, roundIndex: round.index, winnerParticipantId: round.winnerParticipantId });
      continue;
    }

    break; // current round is waiting on people or time
  }

  return { battle: b, events };
}

/** Moderator action: void the whole battle. Ratings and records ignore voided battles. */
export function voidBattle(battle: BattleAggregate, ctx: EngineContext): EngineResult {
  const b = clone(battle);
  b.status = "VOIDED";
  b.endedAt = ctx.now;
  b.winnerParticipantId = null;
  return { battle: b, events: [] };
}

/** The earliest moment `advance` could change this battle, for scheduling. */
export function nextDeadline(battle: BattleAggregate): Date | null {
  if (battle.status === "OPEN_CHALLENGE" || battle.status === "PENDING_ACCEPT") return battle.acceptDeadline;
  const round = currentRound(battle);
  if (!round) return null;
  return round.status === "SUBMISSIONS_OPEN" ? round.submissionsCloseAt : round.votingClosesAt;
}

export function participantIds(battle: BattleAggregate): [string, string] {
  const a = battle.participants.find((p) => p.side === 0);
  const b = battle.participants.find((p) => p.side === 1);
  if (!a || !b) throw new EngineError("NOT_IN_PROGRESS", "battle needs two participants");
  return [a.id, b.id];
}

export function standings(battle: BattleAggregate) {
  const ids = participantIds(battle);
  return battleOutcome(
    battle.rounds.filter((r) => r.status === "SCORED").map((r) => ({ winnerParticipantId: r.winnerParticipantId, tally: battle.tallies[r.id] })),
    ids,
  );
}

/** The AI judge's scorecard: rounds each side won in the AI's view. */
export function aiScorecard(battle: BattleAggregate): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(battle.participants.map((p) => [p.id, 0]));
  for (const r of battle.rounds) {
    if (r.status === "SCORED" && r.aiWinnerParticipantId && r.aiWinnerParticipantId in out) out[r.aiWinnerParticipantId]! += 1;
  }
  return out;
}

// ── Internals (mutate the clone they are given) ───────────────────────────

function newRound(ctx: EngineContext, index: number, suddenDeath: boolean): RoundState {
  return {
    id: ctx.newId(),
    index,
    status: "PENDING",
    suddenDeath,
    submissionsCloseAt: null,
    votingOpensAt: null,
    votingClosesAt: null,
    extensions: 0,
    winnerParticipantId: null,
    aiWinnerParticipantId: null,
    forfeitParticipantIds: [],
  };
}

function openSubmissions(b: BattleAggregate, round: RoundState, ctx: EngineContext): DomainEvent {
  round.status = "SUBMISSIONS_OPEN";
  round.submissionsCloseAt = addMinutes(ctx.now, b.rules.timing.submissionWindowMinutes);
  return { type: "round.submissions_opened", battleId: b.id, roundIndex: round.index, closesAt: round.submissionsCloseAt };
}

function openVoting(b: BattleAggregate, round: RoundState, ctx: EngineContext): DomainEvent {
  round.status = "VOTING_OPEN";
  round.votingOpensAt = ctx.now;
  round.votingClosesAt = addMinutes(ctx.now, b.rules.timing.votingWindowMinutes);
  return { type: "round.voting_opened", battleId: b.id, roundIndex: round.index, closesAt: round.votingClosesAt };
}

function finish(b: BattleAggregate, ctx: EngineContext): DomainEvent[] {
  const outcome = standings(b);
  const hadSuddenDeath = b.rounds.some((r) => r.suddenDeath);
  if (!outcome.winnerParticipantId && b.rules.suddenDeath && !hadSuddenDeath) {
    const round = newRound(ctx, b.rounds.length, true);
    b.rounds.push(round);
    return [{ type: "round.sudden_death_added", battleId: b.id, roundIndex: round.index }, openSubmissions(b, round, ctx)];
  }
  b.status = "COMPLETE";
  b.endedAt = ctx.now;
  b.winnerParticipantId = outcome.winnerParticipantId;
  return [{ type: "battle.completed", battleId: b.id, winnerParticipantId: b.winnerParticipantId }];
}

function clone(b: BattleAggregate): BattleAggregate {
  return {
    ...b,
    participants: b.participants.map((p) => ({ ...p })),
    rounds: b.rounds.map((r) => ({ ...r, forfeitParticipantIds: [...r.forfeitParticipantIds] })),
    submissions: b.submissions.map((s) => ({ ...s })),
    tallies: Object.fromEntries(Object.entries(b.tallies).map(([k, v]) => [k, { ...v }])),
    aiVerdicts: { ...b.aiVerdicts },
  };
}
