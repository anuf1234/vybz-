import type { PlaybackTier } from "@vybz/providers";
import { type BattleAggregate, currentRound, participantFor, submissionsFor } from "./engine";

/**
 * Who may vote, and the fair-listen gate: a vote counts only after the voter
 * has played both sides, at the same playback tier, for long enough.
 */

/** Grace for clock skew and network delay when checking reported play time. */
export const LISTEN_SLACK_MS = 2_000;
/** Apple Music catalog previews are about 30 seconds. */
export const PREVIEW_LENGTH_MS = 30_000;

export interface VoterFacts {
  userId: string;
  emailVerified: boolean;
  createdAt: Date;
  status: "ACTIVE" | "SUSPENDED" | "BANNED";
}

export interface ListenProofFacts {
  submissionId: string;
  playedMs: number;
  tier: PlaybackTier;
}

export interface SubmissionFacts {
  submissionId: string;
  durationMs?: number | null;
}

export type VoteBlockReason =
  | "SIGN_IN_REQUIRED"
  | "ACCOUNT_RESTRICTED"
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_TOO_NEW"
  | "PARTICIPANT"
  | "VOTING_CLOSED"
  | "AI_JUDGED"
  | "ALREADY_VOTED"
  | "UNKNOWN_SUBMISSION"
  | "LISTEN_REQUIRED"
  | "TIER_MISMATCH";

export const VOTE_BLOCK_MESSAGES: Record<VoteBlockReason, string> = {
  SIGN_IN_REQUIRED: "Sign in to vote.",
  ACCOUNT_RESTRICTED: "Your account can't vote right now.",
  EMAIL_NOT_VERIFIED: "Verify your email to vote.",
  ACCOUNT_TOO_NEW: "Your account is too new to vote in this battle.",
  PARTICIPANT: "You can't vote in your own battle.",
  VOTING_CLOSED: "Voting isn't open for this round.",
  AI_JUDGED: "The AI judge decides this battle. Listen along and see its verdict when the round closes.",
  ALREADY_VOTED: "You already voted this round.",
  UNKNOWN_SUBMISSION: "That pick isn't in this round.",
  LISTEN_REQUIRED: "Listen to both tracks to unlock your vote.",
  TIER_MISMATCH: "Play both tracks the same way (both previews or both full) to vote.",
};

/** How long a voter must play a submission. Capped by the track and preview length. */
export function requiredListenMs(minPlayedMs: number, durationMs: number | null | undefined, tier: PlaybackTier | null): number {
  let required = minPlayedMs;
  if (durationMs) required = Math.min(required, durationMs);
  if (tier === "PREVIEW") required = Math.min(required, PREVIEW_LENGTH_MS);
  return Math.max(0, required - LISTEN_SLACK_MS);
}

/**
 * Plausibility check for a client's listen report: a voter can't have played
 * more than the wall-clock time since they started. Never goes backwards.
 */
export function plausiblePlayedMs(startedAt: Date, now: Date, previousMs: number, reportedMs: number): number {
  const elapsed = Math.max(0, now.getTime() - startedAt.getTime()) + LISTEN_SLACK_MS;
  return Math.max(previousMs, Math.min(Math.max(0, Math.floor(reportedMs)), elapsed));
}

export interface VoteCheckInput {
  battle: BattleAggregate;
  roundIndex: number;
  voter: VoterFacts | null;
  /** The submission being voted for; omit to ask "could this viewer vote at all?". */
  submissionId?: string;
  alreadyVoted: boolean;
  proofs: ListenProofFacts[];
  submissions: SubmissionFacts[];
  now: Date;
}

export function checkVote(input: VoteCheckInput): VoteBlockReason | null {
  const { battle, voter, now } = input;
  if (!voter) return "SIGN_IN_REQUIRED";
  if (voter.status !== "ACTIVE") return "ACCOUNT_RESTRICTED";
  const elig = battle.rules.voterEligibility;
  if (elig.requireVerifiedEmail && !voter.emailVerified) return "EMAIL_NOT_VERIFIED";
  if (elig.minAccountAgeHours > 0 && now.getTime() - voter.createdAt.getTime() < elig.minAccountAgeHours * 3_600_000) {
    return "ACCOUNT_TOO_NEW";
  }
  if (participantFor(battle, voter.userId)) return "PARTICIPANT";

  const round = currentRound(battle);
  if (!round || round.index !== input.roundIndex || round.status !== "VOTING_OPEN") return "VOTING_CLOSED";
  if (round.votingClosesAt && now >= round.votingClosesAt) return "VOTING_CLOSED";
  if (battle.rules.judging.mode === "AI") return "AI_JUDGED";
  if (input.alreadyVoted) return "ALREADY_VOTED";

  const subs = submissionsFor(battle, round.id);
  if (input.submissionId !== undefined && !subs.some((s) => s.id === input.submissionId)) return "UNKNOWN_SUBMISSION";

  const proofs = subs.map((s) => input.proofs.find((p) => p.submissionId === s.id));
  if (proofs.some((p) => !p)) return "LISTEN_REQUIRED";
  const tiers = new Set(proofs.map((p) => p!.tier));
  if (tiers.size > 1) return "TIER_MISMATCH";

  for (const s of subs) {
    const proof = proofs.find((p) => p!.submissionId === s.id)!;
    const facts = input.submissions.find((f) => f.submissionId === s.id);
    if (proof.playedMs < requiredListenMs(battle.rules.fairListen.minPlayedMs, facts?.durationMs, proof.tier)) {
      return "LISTEN_REQUIRED";
    }
  }
  return null;
}

/**
 * Display order for a round's entries (seat numbers). With blind voting the
 * order is shuffled per round from the round id, so position gives nothing away.
 */
export function entryOrder(roundId: string, blind: boolean, sides: readonly number[] = [0, 1]): number[] {
  const sorted = [...sides].sort((a, b) => a - b);
  if (!blind) return sorted;
  // Deterministic Fisher–Yates driven by a small PRNG seeded from the round id.
  let h = 2166136261;
  for (let i = 0; i < roundId.length; i++) h = Math.imul(h ^ roundId.charCodeAt(i), 16777619);
  let seed = h >>> 0;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
  }
  return sorted;
}

/** Letter label for an entry position: A, B, C... */
export function entryLetter(index: number): string {
  return String.fromCharCode(65 + index);
}
