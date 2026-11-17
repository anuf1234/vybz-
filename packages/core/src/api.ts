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

/** An artist from catalog search. `artistId` is "<PROVIDER>:<id>". */
export interface ArtistHit {
  artistId: string;
  name: string;
  genres: string[];
  artworkUrl?: string;
}

export interface ArtistSearchResponse {
  items: ArtistHit[];
}

/** An artist and their songs, most popular first. */
export interface ArtistDetailResponse {
  artist: ArtistHit;
  topSongs: CatalogHit[];
}

/** Songs that fit a battle's genres and era, most relevant first. */
export interface SuggestionsResponse {
  title: string;
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
  /** Hearts (per-track votes), when tallies may be shown. */
  hearts: number | null;
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
  /** Who plays this round (all participants, or the tied leaders in sudden death). */
  contenderIds: string[];
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
    /** Tracks this viewer hearted this round. */
    heartedSubmissionIds: string[];
  };
}

export interface ParticipantView {
  id: string;
  side: number;
  user: UserSummary;
  roundsWon: number;
}

export type BattleVisibility = "PUBLIC" | "PRIVATE";
export type BattleFormat = "DUEL" | "MULTI";

export interface BattleStats {
  totalVotes: number;
  uniqueVoters: number;
  /** People who started listening to the battle. */
  listeners: number;
  /** Share of listeners who went on to vote, 0..1. */
  completionRate: number;
  reactions: number;
  chatMessages: number;
  /** The most-hearted track of the battle. */
  topTrack: { track: TrackView; hearts: number; participantId: string } | null;
}

export interface BattleView {
  id: string;
  title: string;
  theme: string | null;
  status: BattleStatus;
  format: BattleFormat;
  visibility: BattleVisibility;
  /** Shown to people who can invite (participants, host): append `?code=` to share a private battle. */
  inviteCode: string | null;
  featured: boolean;
  /** "2026-11-16" for the daily battle of that day. */
  dailyDate: string | null;
  entrants: { min: number; max: number; joined: number };
  stats: BattleStats | null;
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
    canJoin: boolean;
    canLeave: boolean;
    canStart: boolean;
    canDecline: boolean;
    canCancel: boolean;
    canRematch: boolean;
    canChat: boolean;
    isModerator: boolean;
    /** What this viewer should do next, for badges and CTAs. */
    action: ViewerAction;
  };
}

export type ViewerAction = "accept" | "join" | "submit" | "vote" | "wait" | "none";

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
  participants: { id: string; side: number; user: UserSummary; roundsWon: number }[];
  format: BattleFormat;
  visibility: BattleVisibility;
  featured: boolean;
  dailyDate: string | null;
  maxEntrants: number;
  winnerParticipantId: string | null;
  creator: UserSummary;
  invited: UserSummary | null;
  createdAt: string;
  viewerAction: ViewerAction;
}

export type BattleFeed = "home" | "open" | "mine" | "vote" | "featured" | "daily";

export interface BattleListResponse {
  items: BattleListItem[];
}

export interface CreateBattleRequest {
  title: string;
  theme?: string;
  /** Duels: handle of the person to challenge. Omit for an open challenge. */
  opponentHandle?: string;
  /** Multi-entry: people to invite (they get a notification and access to a private battle). */
  inviteHandles?: string[];
  visibility?: BattleVisibility;
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

// ── Live layer ─────────────────────────────────────────────────────────────

export const REACTIONS = ["🔥", "👏", "😂", "😮", "💀", "❤️"] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface ChatMessageView {
  id: string;
  user: UserSummary;
  body: string;
  createdAt: string;
  /** Hidden by a moderator; only moderators receive hidden messages. */
  hidden: boolean;
}

export interface LiveView {
  viewers: number;
  /** Newest last. With `after`, only messages newer than that id. */
  messages: ChatMessageView[];
  /** Reactions in the last minute, for the live burst. */
  recentReactions: Partial<Record<Reaction, number>>;
  reactionTotals: Partial<Record<Reaction, number>>;
}

// ── Notifications ──────────────────────────────────────────────────────────

export type NotificationType =
  | "CHALLENGED"
  | "COUNTERED"
  | "CHALLENGE_ACCEPTED"
  | "INVITED"
  | "PLAYER_JOINED"
  | "BATTLE_STARTED"
  | "YOUR_PICK"
  | "VOTING_OPEN"
  | "ROUND_RESULT"
  | "BATTLE_RESULT";

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  battleId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsResponse {
  items: NotificationView[];
  unread: number;
}

// ── Moderation ─────────────────────────────────────────────────────────────

export type ReportSubject = "CHAT_MESSAGE" | "BATTLE" | "USER";

export interface ReportRequest {
  subjectType: ReportSubject;
  subjectId: string;
  reason: string;
}

export interface ModerationReportView {
  id: string;
  subjectType: ReportSubject;
  subjectId: string;
  reason: string;
  status: "OPEN" | "ACTIONED" | "DISMISSED";
  reporter: UserSummary;
  createdAt: string;
  /** What the report is about, for context in the queue. */
  context: { battleId: string | null; battleTitle: string | null; text: string | null; user: UserSummary | null };
  reportCount: number;
}

export type ModerationAction = "DISMISS" | "HIDE_MESSAGE" | "VOID_BATTLE" | "SUSPEND_USER";

// ── Library and playlists ──────────────────────────────────────────────────

/** A stored song in a list (saved songs or a playlist). Usable anywhere a search hit is, e.g. to pick it in a battle. */
export interface SavedTrack extends CatalogHit {
  trackId: string;
}

export interface LibraryResponse {
  items: (SavedTrack & { savedAt: string })[];
  /** Track ids in the library, for showing saved state elsewhere. */
  trackIds: string[];
}

export type PlaylistVisibility = "PUBLIC" | "PRIVATE";

export interface PlaylistSummary {
  id: string;
  title: string;
  description: string | null;
  owner: UserSummary;
  visibility: PlaylistVisibility;
  trackCount: number;
  /** Up to four covers for a mosaic. */
  artworkUrls: string[];
  genres: string[];
  eraFrom: number | null;
  eraTo: number | null;
  updatedAt: string;
}

export interface PlaylistTrackView extends SavedTrack {
  position: number;
  addedBy: UserSummary | null;
}

export interface PlaylistView extends PlaylistSummary {
  tracks: PlaylistTrackView[];
  collaborators: UserSummary[];
  /** Only for people who can share it: append `?code=` to the link for private playlists. */
  shareCode: string | null;
  viewer: { isOwner: boolean; canEdit: boolean };
}

export interface PlaylistListResponse {
  items: PlaylistSummary[];
}

export interface CreatePlaylistRequest {
  title: string;
  description?: string;
  visibility?: PlaylistVisibility;
  /** Fill it with suggestions for this theme (VYBZ genre keys, years). */
  generate?: { genres: string[]; eraFrom?: number; eraTo?: number; size?: number };
}

export const PLAYLIST_MAX_TRACKS = 200;
