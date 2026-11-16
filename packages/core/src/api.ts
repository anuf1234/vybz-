/**
 * Shapes of the public /api/v1 responses, shared by the server and the apps.
 * Type-only: importing this file adds nothing to a bundle.
 */
import type { PlaybackSource, PlaybackTier } from "@vybz/providers";
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

export interface EntryView {
  submissionId: string;
  track: TrackView;
  /** Null while blind voting hides who picked it. */
  participantId: string | null;
  /** The source to play for this viewer, at the round's parity tier. */
  playback: PlaybackSource | null;
  /** Present when tallies may be shown. */
  votes: { count: number; weighted: number } | null;
  /** This viewer's listen progress on the entry. */
  listen: { playedMs: number; requiredMs: number; tier: PlaybackTier | null };
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
  viewer: {
    /** For participants: their own pick this round (visible to them even while sealed). */
    mySubmission: { submissionId: string; track: TrackView } | null;
    opponentSubmitted: boolean;
    votedSubmissionId: string | null;
    canVote: boolean;
    voteBlockedReason: VoteBlockReason | null;
    /** Tier both entries play at for this viewer. Null: voting stays locked (LINK_OUT only). */
    parityTier: PlaybackTier | null;
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
  currentRoundIndex: number | null;
  rematchOfId: string | null;
  rounds: RoundView[];
  viewer: {
    userId: string | null;
    participantId: string | null;
    canAccept: boolean;
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
  catalogId: string;
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
