import type { PlaybackTier, ProviderKind } from "@vybz/providers";
import type { BattleRules, BattleStatus, JudgingMode, PlaybackOption, RoundStatus, VoteBlockReason } from "@vybz/core";
import { themeLabel } from "@vybz/core";

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
  PENDING_ACCEPT: "Agreeing terms",
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
  AI_JUDGED: "The AI judge decides this one — listen along",
  ALREADY_VOTED: "Vote locked in",
  UNKNOWN_SUBMISSION: "That pick isn't in this round",
  LISTEN_REQUIRED: "Listen to both tracks to unlock your vote",
  TIER_MISMATCH: "These tracks can't be heard the same way here",
};

/** Label for a round's two entries: A and B while blind, handles after reveal. */
export function entryLabel(index: number): string {
  return index === 0 ? "A" : "B";
}


export const JUDGING_LABEL: Record<JudgingMode, string> = {
  CROWD: "Crowd votes",
  AI: "AI judge",
  COMBINED: "Crowd + AI together",
  SEPARATE: "Crowd and AI, separate cards",
};

export const JUDGING_HELP: Record<JudgingMode, string> = {
  CROWD: "Listeners vote. Most votes takes the round.",
  AI: "The AI judge alone decides each round. Listeners can still listen along.",
  COMBINED: "One score: the crowd's vote share plus the AI's pick, weighted.",
  SEPARATE: "Two scorecards. The crowd's card decides the battle; the AI's card is shown next to it.",
};

export function judgingSummary(r: BattleRules): string {
  const m = r.judging.mode;
  return m === "COMBINED" ? `Crowd ${100 - r.judging.aiWeightPercent}% + AI ${r.judging.aiWeightPercent}%` : JUDGING_LABEL[m];
}

export function windowLabel(min: number): string {
  if (min % (24 * 60) === 0) return `${min / (24 * 60)}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}m`;
}

/** Human-readable terms, in a fixed order, for showing and diffing. */
export function termsList(r: BattleRules): { key: string; label: string; value: string }[] {
  return [
    { key: "theme", label: "Genre & era", value: themeLabel(r.constraints) ?? "Anything goes" },
    { key: "rounds", label: "Rounds", value: String(r.roundCount) },
    { key: "tracks", label: "Tracks per round", value: String(r.tracksPerRound) },
    { key: "judging", label: "Judging", value: judgingSummary(r) },
    { key: "pace", label: "Pace", value: `${windowLabel(r.timing.submissionWindowMinutes)} to pick · ${windowLabel(r.timing.votingWindowMinutes)} to vote` },
    { key: "blind", label: "Blind voting", value: r.blindVoting ? "On" : "Off" },
    { key: "tallies", label: "Vote counts", value: r.revealTallies === "LIVE" ? "Live" : r.revealTallies === "AT_BATTLE_END" ? "At the end" : "After each round" },
  ];
}

/** Index of the option to use: the preferred service if this round offers it, else the best. */
export function chooseOption(options: PlaybackOption[], preferredService: ProviderKind | null): number {
  const i = options.findIndex((o) => o.provider === preferredService);
  return i >= 0 ? i : 0;
}
