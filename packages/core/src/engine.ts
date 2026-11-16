import { trackMatchesGenres } from "./genres";
import { type BattleRules, isDuel } from "./rules";
import { type RoundTally, battleOutcome, judgeRound, totalVotes } from "./scoring";

/**
 * Battle engine: a state machine over an in-memory battle aggregate.
 *
 * No I/O. Callers load the aggregate, call one function, persist the returned
 * aggregate (with optimistic locking on `version`) and handle the events.
 * Every function returns a new aggregate; inputs are never mutated.
 *
 * Two formats share one engine:
 *  - Duel (entrants.max = 2): open or direct challenge; the other side accepts
 *    or counters the terms until both agree.
 *  - Multi-entry (up to 8): a lobby people join; it starts when full, when the
 *    host starts it with at least `entrants.min`, or at the join deadline.
 */

export type BattleStatus = "OPEN_CHALLENGE" | "PENDING_ACCEPT" | "IN_PROGRESS" | "COMPLETE" | "CANCELLED" | "EXPIRED" | "VOIDED";
export type RoundStatus = "PENDING" | "SUBMISSIONS_OPEN" | "VOTING_OPEN" | "SCORED" | "VOIDED";

export const MAX_COUNTER_OFFERS = 10;

export const TERMINAL_BATTLE_STATUSES: readonly BattleStatus[] = ["COMPLETE", "CANCELLED", "EXPIRED", "VOIDED"];

export interface ParticipantState {
  id: string;
  userId: string;
  /** Seat number, 0-based. Duels use 0 and 1. */
  side: number;
}

export interface RoundState {
  id: string;
  index: number;
  status: RoundStatus;
  suddenDeath: boolean;
  /** Who plays this round; null means every participant. Sudden death is only for the tied leaders. */
  contenderIds: string[] | null;
  submissionsCloseAt: Date | null;
  votingOpensAt: Date | null;
  votingClosesAt: Date | null;
  extensions: number;
  winnerParticipantId: string | null;
  /** The AI judge's pick, recorded when the round is scored (modes that use the AI). */
  aiWinnerParticipantId: string | null;
  /** Contenders who missed the submission deadline for this round. */
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
  /** Duels: the challenger (null while an open challenge has no taker). Unused for multi-entry. */
  invitedUserId: string | null;
  /** Duels: who proposed the current terms; the other side accepts or counters. */
  proposedByUserId: string;
  /** Terms before the latest counter-offer, so the app can show what changed. */
  previousRules: BattleRules | null;
  counterCount: number;
  /** Duels: deadline to accept. Multi-entry: deadline to join. */
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
  | { type: "battle.joined"; battleId: string; userId: string }
  | { type: "battle.left"; battleId: string; userId: string }
  | { type: "battle.started"; battleId: string }
  | { type: "battle.cancelled"; battleId: string }
  | { type: "battle.expired"; battleId: string }
  | { type: "round.submissions_opened"; battleId: string; roundIndex: number; closesAt: Date; contenderIds: string[] }
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
  | "NOT_A_CONTENDER"
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
  | "TOO_MANY_COUNTERS"
  | "NOT_A_DUEL"
  | "NOT_MULTI"
  | "ALREADY_JOINED"
  | "BATTLE_FULL"
  | "NOT_ENOUGH_ENTRANTS"
  | "INVALID_TERMS";

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

// ── Creation ───────────────────────────────────────────────────────────────

export interface CreateBattleInput {
  id?: string;
  creatorId: string;
  /** Duels only: challenge someone directly. */
  invitedUserId?: string | null;
  rules: BattleRules;
}

export function createBattle(input: CreateBattleInput, ctx: EngineContext): EngineResult {
  const duel = isDuel(input.rules);
  if (input.invitedUserId && input.invitedUserId === input.creatorId) throw new EngineError("OWN_BATTLE");
  if (!duel && input.invitedUserId) throw new EngineError("NOT_A_DUEL", "direct challenges are for duels; invite people to multi-entry battles instead");
  if (duel && !input.rules.creatorPlays) throw new EngineError("INVALID_TERMS", "the creator of a duel has to play");
  const id = input.id ?? ctx.newId();
  const rounds: RoundState[] = Array.from({ length: input.rules.roundCount }, (_, index) => newRound(ctx, index, false, null));
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
    participants: input.rules.creatorPlays ? [{ id: ctx.newId(), userId: input.creatorId, side: 0 }] : [],
    rounds,
    submissions: [],
    tallies: {},
    aiVerdicts: {},
  };
  return { battle, events: [{ type: "battle.created", battleId: id }] };
}

// ── Duels: accept or counter ───────────────────────────────────────────────

/**
 * Who must answer the current terms of a duel: whoever didn't propose them.
 * Null for an open challenge (anyone but the creator may answer) and multi-entry.
 */
export function awaitingResponseFrom(battle: BattleAggregate): string | null {
  if (battle.status !== "PENDING_ACCEPT") return null;
  return battle.proposedByUserId === battle.creatorId ? battle.invitedUserId : battle.creatorId;
}

/** Can `userId` accept/counter (duel) or join (multi-entry) right now? */
export function canRespond(battle: BattleAggregate, userId: string, now: Date): boolean {
  if (battle.acceptDeadline && now >= battle.acceptDeadline) return false;
  if (!isDuel(battle.rules)) {
    return battle.status === "OPEN_CHALLENGE" && !participantFor(battle, userId) && battle.participants.length < battle.rules.entrants.max;
  }
  if (battle.status === "OPEN_CHALLENGE") return userId !== battle.creatorId;
  return battle.status === "PENDING_ACCEPT" && awaitingResponseFrom(battle) === userId;
}

function assertCanRespond(b: BattleAggregate, userId: string, now: Date) {
  if (!isDuel(b.rules)) throw new EngineError("NOT_A_DUEL");
  if (b.status !== "OPEN_CHALLENGE" && b.status !== "PENDING_ACCEPT") throw new EngineError("NOT_OPEN");
  if (b.acceptDeadline && now >= b.acceptDeadline) throw new EngineError("NOT_OPEN", "challenge expired");
  if (b.status === "OPEN_CHALLENGE") {
    if (userId === b.creatorId) throw new EngineError("OWN_BATTLE");
    return;
  }
  if (userId !== b.creatorId && userId !== b.invitedUserId) throw new EngineError("NOT_INVITED");
  if (awaitingResponseFrom(b) !== userId) throw new EngineError("NOT_YOUR_TURN", "waiting for the other side to answer your terms");
}

/** Duel: both sides agree to the current terms and the battle starts. Multi-entry: joins. */
export function acceptBattle(battle: BattleAggregate, userId: string, ctx: EngineContext): EngineResult {
  if (!isDuel(battle.rules)) return joinBattle(battle, userId, ctx);
  const b = clone(battle);
  assertCanRespond(b, userId, ctx.now);
  if (b.status === "OPEN_CHALLENGE") b.invitedUserId = userId;
  b.participants.push({ id: ctx.newId(), userId: b.invitedUserId!, side: 1 });
  return { battle: b, events: [{ type: "battle.accepted", battleId: b.id, userId }, ...start(b, ctx)] };
}

/**
 * Duel: propose different terms (rounds, tracks per round, genre, era,
 * judging...). Countering an open challenge makes it a direct negotiation.
 */
export function counterOffer(battle: BattleAggregate, userId: string, rules: BattleRules, ctx: EngineContext): EngineResult {
  const b = clone(battle);
  assertCanRespond(b, userId, ctx.now);
  if (!isDuel(rules) || !rules.creatorPlays) throw new EngineError("NOT_A_DUEL", "a counter-offer can't turn a duel into a multi-entry battle");
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
    b.rounds = Array.from({ length: rules.roundCount }, (_, index) => b.rounds[index] ?? newRound(ctx, index, false, null));
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

// ── Multi-entry: join, leave, start ────────────────────────────────────────

export function joinBattle(battle: BattleAggregate, userId: string, ctx: EngineContext): EngineResult {
  const b = clone(battle);
  if (isDuel(b.rules)) throw new EngineError("NOT_MULTI");
  if (b.status !== "OPEN_CHALLENGE") throw new EngineError("NOT_OPEN");
  if (b.acceptDeadline && ctx.now >= b.acceptDeadline) throw new EngineError("NOT_OPEN", "entries have closed");
  if (participantFor(b, userId)) throw new EngineError("ALREADY_JOINED");
  if (b.participants.length >= b.rules.entrants.max) throw new EngineError("BATTLE_FULL");
  const taken = new Set(b.participants.map((p) => p.side));
  let side = 0;
  while (taken.has(side)) side++;
  b.participants.push({ id: ctx.newId(), userId, side });
  const events: DomainEvent[] = [{ type: "battle.joined", battleId: b.id, userId }];
  if (b.participants.length === b.rules.entrants.max) events.push(...start(b, ctx));
  return { battle: b, events };
}

export function leaveBattle(battle: BattleAggregate, userId: string): EngineResult {
  const b = clone(battle);
  if (isDuel(b.rules)) throw new EngineError("NOT_MULTI");
  if (b.status !== "OPEN_CHALLENGE") throw new EngineError("NOT_OPEN", "the battle has started");
  if (userId === b.creatorId) throw new EngineError("NOT_PARTICIPANT", "hosts cancel the battle instead of leaving");
  const p = participantFor(b, userId);
  if (!p) throw new EngineError("NOT_PARTICIPANT");
  b.participants = b.participants.filter((x) => x.id !== p.id);
  return { battle: b, events: [{ type: "battle.left", battleId: b.id, userId }] };
}

/** The host starts a multi-entry battle early, once enough people have joined. */
export function startBattle(battle: BattleAggregate, userId: string, ctx: EngineContext): EngineResult {
  const b = clone(battle);
  if (isDuel(b.rules)) throw new EngineError("NOT_MULTI");
  if (b.creatorId !== userId) throw new EngineError("NOT_CREATOR");
  if (b.status !== "OPEN_CHALLENGE") throw new EngineError("NOT_OPEN");
  if (b.participants.length < Math.max(2, b.rules.entrants.min)) {
    throw new EngineError("NOT_ENOUGH_ENTRANTS", `needs at least ${Math.max(2, b.rules.entrants.min)} players`);
  }
  return { battle: b, events: start(b, ctx) };
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

/** Participant ids playing this round. */
export function contendersFor(battle: BattleAggregate, round: RoundState): string[] {
  return round.contenderIds ?? battle.participants.map((p) => p.id);
}

/** Contenders who submitted a set this round. */
export function presentFor(battle: BattleAggregate, round: RoundState): string[] {
  const submitted = new Set(submissionsFor(battle, round.id).map((s) => s.participantId));
  return contendersFor(battle, round).filter((id) => submitted.has(id));
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
  if (!contendersFor(b, round).includes(participant.id)) throw new EngineError("NOT_A_CONTENDER", "this sudden-death round is for the tied leaders");
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
    b.submissions.push({ id: input.submissionIds?.[position] ?? ctx.newId(), roundId: round.id, participantId: participant.id, trackId: t.id, position });
  });
  const events: DomainEvent[] = [{ type: "round.submitted", battleId: b.id, roundIndex: round.index, participantId: participant.id }];
  if (presentFor(b, round).length === contendersFor(b, round).length) events.push(openVoting(b, round, ctx));
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
    // A multi-entry lobby with enough players starts at its join deadline.
    if (!isDuel(b.rules) && b.status === "OPEN_CHALLENGE" && b.participants.length >= Math.max(2, b.rules.entrants.min)) {
      events.push(...start(b, ctx));
    } else {
      b.status = "EXPIRED";
      b.endedAt = ctx.now;
      events.push({ type: "battle.expired", battleId: b.id });
      return { battle: b, events };
    }
  }

  // Bounded loop: each pass moves one round forward by one step.
  for (let guard = 0; guard < b.rounds.length * 4 + 8 && b.status === "IN_PROGRESS"; guard++) {
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
      const present = presentFor(b, round);
      round.forfeitParticipantIds = contendersFor(b, round).filter((id) => !present.includes(id));
      if (present.length >= 2) {
        // Missing players forfeit; the rest go to the vote.
        events.push(openVoting(b, round, ctx));
        continue;
      }
      // One player showed up: they take the round. Nobody: a draw.
      round.winnerParticipantId = present[0] ?? null;
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
      const judged = judgeRound(mode, aiWeightPercent, tally, aiPick, presentFor(b, round));
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

/** All participant ids, in seat order. */
export function participantIds(battle: BattleAggregate): string[] {
  return [...battle.participants].sort((a, b) => a.side - b.side).map((p) => p.id);
}

export function standings(battle: BattleAggregate) {
  return battleOutcome(
    battle.rounds.filter((r) => r.status === "SCORED").map((r) => ({ winnerParticipantId: r.winnerParticipantId, tally: battle.tallies[r.id] })),
    participantIds(battle),
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

function newRound(ctx: EngineContext, index: number, suddenDeath: boolean, contenderIds: string[] | null): RoundState {
  return {
    id: ctx.newId(),
    index,
    status: "PENDING",
    suddenDeath,
    contenderIds,
    submissionsCloseAt: null,
    votingOpensAt: null,
    votingClosesAt: null,
    extensions: 0,
    winnerParticipantId: null,
    aiWinnerParticipantId: null,
    forfeitParticipantIds: [],
  };
}

function start(b: BattleAggregate, ctx: EngineContext): DomainEvent[] {
  b.status = "IN_PROGRESS";
  b.startedAt = ctx.now;
  b.acceptDeadline = null;
  const events: DomainEvent[] = [{ type: "battle.started", battleId: b.id }];
  const first = b.rounds[0];
  if (first) events.push(openSubmissions(b, first, ctx));
  return events;
}

function openSubmissions(b: BattleAggregate, round: RoundState, ctx: EngineContext): DomainEvent {
  round.status = "SUBMISSIONS_OPEN";
  round.submissionsCloseAt = addMinutes(ctx.now, b.rules.timing.submissionWindowMinutes);
  return { type: "round.submissions_opened", battleId: b.id, roundIndex: round.index, closesAt: round.submissionsCloseAt, contenderIds: contendersFor(b, round) };
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
  if (!outcome.winnerParticipantId && b.rules.suddenDeath && !hadSuddenDeath && outcome.leaders.length >= 2) {
    const round = newRound(ctx, b.rounds.length, true, outcome.leaders);
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
    rounds: b.rounds.map((r) => ({ ...r, contenderIds: r.contenderIds ? [...r.contenderIds] : null, forfeitParticipantIds: [...r.forfeitParticipantIds] })),
    submissions: b.submissions.map((s) => ({ ...s })),
    tallies: Object.fromEntries(Object.entries(b.tallies).map(([k, v]) => [k, { ...v }])),
    aiVerdicts: { ...b.aiVerdicts },
  };
}
