import type { PlaybackTier } from "@vybz/providers";
import type { BattleStatus, RoundStatus, VoteBlockReason } from "@vybz/core";

/** "2d 4h", "3h 12m", "4m 05s", "now". */
export function countdown(deadlineIso: string | null, nowMs: number): string | null {
  if (!deadlineIso) return null;
  const ms = new Date(deadlineIso).getTime() - nowMs;
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

export function seconds(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 1000))}s`;
}

export const TIER_LABEL: Record<PlaybackTier, string> = {
  HOSTED_FULL: "Full track",
  PROVIDER_FULL: "Full track",
  EMBED: "Video",
  PREVIEW: "30s preview",
  LINK_OUT: "Link only",
};

export const STATUS_LABEL: Record<BattleStatus, string> = {
  OPEN_CHALLENGE: "Open challenge",
  PENDING_ACCEPT: "Waiting to accept",
  IN_PROGRESS: "Live",
  COMPLETE: "Final",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  VOIDED: "Voided",
};

export function roundPhase(status: RoundStatus | null): string {
  switch (status) {
    case "SUBMISSIONS_OPEN":
      return "Picking";
    case "VOTING_OPEN":
      return "Voting";
    case "SCORED":
      return "Scored";
    default:
      return "";
  }
}

export const VOTE_REASON: Record<VoteBlockReason, string> = {
  SIGN_IN_REQUIRED: "Sign in to vote",
  ACCOUNT_RESTRICTED: "Your account can't vote right now",
  EMAIL_NOT_VERIFIED: "Verify your email to vote",
  ACCOUNT_TOO_NEW: "Your account is too new for this battle",
  PARTICIPANT: "You're in this battle — the crowd decides",
  VOTING_CLOSED: "Voting is closed",
  ALREADY_VOTED: "Vote locked in",
  UNKNOWN_SUBMISSION: "That pick isn't in this round",
  LISTEN_REQUIRED: "Listen to both tracks to unlock your vote",
  TIER_MISMATCH: "These tracks can't be heard the same way here",
};

/** Label for a round's two entries: A and B while blind, handles after reveal. */
export function entryLabel(index: number): string {
  return index === 0 ? "A" : "B";
}
