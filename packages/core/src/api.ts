/**
 * Shapes of the public /api/v1 responses, shared by the server and the apps.
 * Type-only: importing this file adds nothing to a bundle.
 */
import type { PlaybackSource, PlaybackTier, ProviderKind } from "@vybz/providers";
import type { BattleStatus, RoundStatus } from "./engine";
import type { BattleRules, BattleRulesInput } from "./rules";
import type { Role } from "./policy";
import type { VoteBlockReason } from "./voting";

export interface UserSummary {
  id: string;
  handle: string;
  displayName: string;
  image: string | null;
}

export interface MeView extends UserSummary {
  email: string;
  emailVerified: boolean;
  role: Role;
  createdAt: string;
}

export interface TrackView {
  id: string;
  title: string;
  artistName: string;
  albumName: string | null;
  releaseYear: number | null;
  durationMs: number | null;
  artworkUrl: string | null;
  explicit: boolean;
}

/** A catalog search hit. `catalogId` is what you submit to a battle. */
export interface CatalogHit {
  catalogId: string;
  title: string;
  artistName: string;
  albumName?: string;
  releaseYear?: number;
  durationMs?: number;
  artworkUrl?: string;
  explicit?: boolean;
  /** Best first. Tells the picker how a guest would hear it. */
  sources: PlaybackSource[];
}

export interface CatalogSearchResponse {
  items: CatalogHit[];
}

/**
 * A way to hear the whole round: one service, at one tier, available for every
 * track on both sides. Picking one keeps playback fair (both sides heard alike).
 */
export interface PlaybackOption {
  provider: ProviderKind;
  tier: PlaybackTier;
  /** "YouTube", "Apple Music"... */
  label: string;
}

/** One track in a side's set for a round. */
export interface EntryTrackView {
  submissionId: string;
  track: TrackView;
  /** The source for the round's default option (the first of `viewer.playbackOptions`). */
  playback: PlaybackSource | null;
  /** One source per round playback option, in the same order. */
  sources: PlaybackSource[];
  /**
   * This viewer's listen progress on the track. `tier` is the tier the progress
   * was recorded at (null before any listening); it only counts toward a vote
   * when every track was heard at the same tier.
   */
  listen: { playedMs: number; requiredMs: number; tier: PlaybackTier | null };
}

/** One side's entry for a round: its set of `tracksPerRound` tracks. */
export interface EntryView {
  /** Identifies the side for voting: the submission id of its first track. */
  submissionId: string;
  tracks: EntryTrackView[];
  /** Null while blind voting hides who picked it. */
  participantId: string | null;
  /** Present when tallies may be shown. */
  votes: { count: number; weighted: number } | null;
}

export interface AiVerdictView {
  /** The entry (first submission id) the AI picked. */
  submissionId: string;
  participantId: string;
  confidence: number;
  reason: string;
  /** "claude-sonnet-5-5", or "demo" for the development stand-in. */
  model: string;
}

export interface RoundView {
  index: number;
  status: RoundStatus;
  suddenDeath: boolean;
  submissionsCloseAt: string | null;
  votingClosesAt: string | null;
  winnerParticipantId: string | null;
  forfeitParticipantIds: string[];
  entries: EntryView[];
  /** Total votes, when tallies may be shown. */
  totalVotes: number | null;
  /** The AI judge's pick and reasoning, shown once the round is scored. */
  ai: AiVerdictView | null;
  /** The crowd's own winner (differs from the official winner in COMBINED or AI modes). */
  crowdWinnerParticipantId: string | null;
  viewer: {
    /** For participants: their own picks this round (visible to them even while sealed). */
    mySubmission: { submissionId: string; tracks: TrackView[] } | null;
    opponentSubmitted: boolean;
    votedSubmissionId: string | null;
    canVote: boolean;
    voteBlockedReason: VoteBlockReason | null;
    /** Tier both entries play at by default for this viewer. Null: voting stays locked (LINK_OUT only). */
    parityTier: PlaybackTier | null;
    /** Services this viewer can hear the whole round on, best first. */
    playbackOptions: PlaybackOption[];
  };
}

export interface ParticipantView {
  id: string;
  side: 0 | 1;
  user: UserSummary;
  roundsWon: number;
}

export interface BattleView {
  id: string;
  title: string;
  theme: string | null;
  status: BattleStatus;
  rules: BattleRules;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  acceptDeadline: string | null;
  creator: UserSummary;
  invited: UserSummary | null;
  participants: ParticipantView[];
  winnerParticipantId: string | null;
  /** SEPARATE and COMBINED modes: rounds each participant won on the AI's card. */
  aiScorecard: Record<string, number> | null;
  currentRoundIndex: number | null;
  /** Terms negotiation, before the battle starts. */
  terms: {
    proposedBy: UserSummary;
    /** Who has to answer; null for an open challenge (anyone). */
    awaiting: UserSummary | null;
    previousRules: BattleRules | null;
    counterCount: number;
  };
  rematchOfId: string | null;
  rounds: RoundView[];
  viewer: {
    userId: string | null;
    participantId: string | null;
    canAccept: boolean;
    canCounter: boolean;
    canDecline: boolean;
    canCancel: boolean;
    canRematch: boolean;
    /** What this viewer should do next, for badges and CTAs. */
    action: ViewerAction;
  };
}

export type ViewerAction = "accept" | "submit" | "vote" | "wait" | "none";

export interface BattleListItem {
  id: string;
  title: string;
  theme: string | null;
  status: BattleStatus;
  roundCount: number;
  currentRoundIndex: number | null;
  currentRoundStatus: RoundStatus | null;
  /** Deadline of whatever is happening now. */
  deadline: string | null;
  participants: { id: string; side: 0 | 1; user: UserSummary; roundsWon: number }[];
  winnerParticipantId: string | null;
  creator: UserSummary;
  invited: UserSummary | null;
  createdAt: string;
  viewerAction: ViewerAction;
}

export type BattleFeed = "home" | "open" | "mine" | "vote";

export interface BattleListResponse {
  items: BattleListItem[];
}

export interface CreateBattleRequest {
  title: string;
  theme?: string;
  /** Handle of the person to challenge. Omit for an open challenge. */
  opponentHandle?: string;
  rules?: BattleRulesInput;
}

export interface SubmitRequest {
  /** The side's whole set for the round, `tracksPerRound` long. */
  catalogIds: string[];
}

export interface CounterRequest {
  rules: BattleRulesInput;
}

export interface ConfigResponse {
  aiJudge: { available: boolean; label: string | null; note: string };
  /** Catalogs players can search when picking tracks, primary first. */
  catalogs: { provider: ProviderKind; label: string }[];
  /** Services configured for playback. */
  playback: { appleMusic: boolean; youtube: boolean };
  genres: { key: string; label: string }[];
  decades: number[];
  roundCounts: number[];
  tracksPerRound: number[];
}

export interface ListenRequest {
  submissionId: string;
  playedMs: number;
  tier: PlaybackTier;
}

export interface VoteRequest {
  submissionId: string;
}

export interface RankingEntry {
  rank: number;
  user: UserSummary;
  wins: number;
  losses: number;
  draws: number;
  roundsWon: number;
}

export interface RankingsResponse {
  items: RankingEntry[];
}

export interface ProfileView {
  user: UserSummary;
  record: { wins: number; losses: number; draws: number; battles: number; roundsWon: number };
  recent: BattleListItem[];
}

export interface ApiError {
  error: string;
  message?: string;
  details?: unknown;
}
