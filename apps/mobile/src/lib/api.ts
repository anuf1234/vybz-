import type {
  ArtistFollowHit,
  MusicLinkStatus,
  TopDropsResponse,
  DjLesson,
  ProStatus,
  RankedResponse,
  TournamentListItem,
  TournamentView,
  ArtistPage,
  ArtistProfileView,
  MetricsResponse,
  ChartResponse,
  VerdictPair,
  DropsResponse,
  FollowedArtist,
  ReleaseKind,
  ReleaseView,
  TodayView,
  OnboardingState,
  AlbumHit,
  WarKind,
  WarListItem,
  WarPeriod,
  WarRankingsResponse,
  WarView,
  DjBattleView,
  DjLessonStepResult,
  DjSetView,
  DjUniversityResponse,
  TriviaAdminList,
  TriviaAdminQuestion,
  TriviaAnswerResult,
  TriviaCategory,
  TriviaHubResponse,
  TriviaLeaderboardPeriod,
  TriviaLeaderboardResponse,
  TriviaPlayView,
  TriviaQuestionInput,
  TriviaQuestionStatus,
  GifView,
  ImportPlaylistResponse,
  ShopResponse,
  QuickBattleRequest,
  QuickBattleResponse,
  WalletResponse,
  ProgressView,
  DailyClaimResponse,
  DailyRewardState,
  AchievementsResponse,
  LeaderboardMetric,
  LeaderboardPeriod,
  LeaderboardResponse,
  LeaderboardScope,
  CommentView,
  ConversationView,
  CreatePostRequest,
  DirectMessageView,
  FeedResponse,
  InboxResponse,
  PeopleSuggestion,
  PostDetailResponse,
  UserListResponse,
  CreatePlaylistRequest,
  LibraryResponse,
  PlaylistListResponse,
  PlaylistView,
  ArtistDetailResponse,
  ArtistSearchResponse,
  SuggestionsResponse,
  ApiError,
  BattleFeed,
  BattleListResponse,
  BattleRulesInput,
  BattleView,
  CatalogSearchResponse,
  ConfigResponse,
  LiveView,
  ChatMessageView,
  ModerationAction,
  ModerationReportView,
  NotificationsResponse,
  Reaction,
  ReportRequest,
  CreateBattleRequest,
  ListenRequest,
  MeView,
  ProfileView,
  RankingsResponse,
} from "@vybz/core";
import type { ProviderKind } from "@vybz/providers";
import { Platform } from "react-native";
import { appleMusicFullEnabled } from "./apple-music";
import { authClient } from "./auth-client";
import { API_URL } from "./config";

let guestKey: string | null = null;
/** A random per-install key (not tied to any identity) for viewer counts and guest reactions. */
function viewerKey(): string {
  guestKey ??= Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
  return guestKey;
}

/** The phone's IANA time zone, so "today" is the person's day. */
export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Lets the server offer full Apple Music tracks to subscribers on this device.
  if (appleMusicFullEnabled()) headers["X-VYBZ-Apple-Music"] = "full";
  // Anonymous key so guests count as viewers and can react.
  headers["X-VYBZ-Viewer"] = viewerKey();
  // Native: send the session cookie from SecureStore. Web: the browser sends it.
  if (Platform.OS !== "web") {
    const cookie = await authClient.getCookie();
    if (cookie) headers.Cookie = cookie;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: Platform.OS === "web" ? "include" : "omit",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "Can't reach VYBZ. Check your connection.");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: usually the server restarting behind its load balancer.
    if (!res.ok) throw new ApiRequestError(res.status, "UNAVAILABLE", "VYBZ is restarting. Try again in a few seconds.");
    throw new ApiRequestError(res.status, "BAD_RESPONSE", "Got an unexpected answer from VYBZ. Try again.");
  }
  if (!res.ok) {
    const err = (json ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(res.status, err.error ?? "ERROR", err.message ?? describeError(err.error ?? "", res.status));
  }
  return json as T;
}

/** Downloads text (CSV exports) with the session, for staff. */
export async function requestText(path: string): Promise<string> {
  const headers: Record<string, string> = { Accept: "text/csv" };
  if (Platform.OS !== "web") {
    const cookie = await authClient.getCookie();
    if (cookie) headers.Cookie = cookie;
  }
  const res = await fetch(`${API_URL}${path}`, { headers, credentials: Platform.OS === "web" ? "include" : "omit" }).catch(() => {
    throw new ApiRequestError(0, "NETWORK", "Can't reach VYBZ. Check your connection.");
  });
  const text = await res.text();
  if (!res.ok) throw new ApiRequestError(res.status, "ERROR", res.status === 403 ? "Staff only." : "Couldn't export that. Try again.");
  return text;
}

const MESSAGES: Record<string, string> = {
  SIGN_IN_REQUIRED: "Sign in to do that.",
  EMAIL_NOT_VERIFIED: "Verify your email first. Check your inbox.",
  ACCOUNT_RESTRICTED: "Your account can't do that right now.",
  OPPONENT_NOT_FOUND: "No one has that handle.",
  OWN_BATTLE: "You can't battle yourself.",
  NOT_OPEN: "This challenge is no longer open.",
  NOT_INVITED: "This challenge was sent to someone else.",
  TRACK_ALREADY_USED: "That track is already in this battle. Pick another.",
  TRACK_OUTSIDE_ERA: "That track is outside this battle's era.",
  TRACK_YEAR_UNKNOWN: "We couldn't find when that song first came out, so it can't be checked against this battle's era. Try finding it under Apple Music.",
  TRACK_NOT_PLAYABLE: "That track can't be played for everyone. Try another version.",
  ROUND_NOT_ACCEPTING_SUBMISSIONS: "Picks are closed for this round.",
  ALREADY_SUBMITTED: "You already picked for this round.",
  ALREADY_VOTED: "You already voted this round.",
  INVALID_QUERY: "That leaderboard isn't available.",
  BOT_UNAVAILABLE: "The VYBZ bot isn't available right now.",
  NOT_ENOUGH_COINS: "Not enough coins yet.",
  MAX_HELD: "You can hold 2 streak freezes at a time.",
  OWNED: "You already own this.",
  LEVEL_TOO_LOW: "Level up to unlock this.",
  NOT_OWNED: "Buy this frame first.",
  INVALID_PLAYLIST_LINK: "That doesn't look like a YouTube playlist link.",
  PLAYLIST_NOT_FOUND: "We couldn't open that playlist. Is it public or unlisted?",
  IMPORT_UNAVAILABLE: "Importing isn't available right now.",
  INVALID_GIF: "That GIF couldn't be used.",
  NOT_CURRENT_QUESTION: "That question was already answered.",
  ALREADY_FINISHED: "You've finished this game.",
  LYRICS_NOT_ALLOWED: "Questions can't quote lyrics.",
  IS_SINGLE: "That's a single. Start a Single War for songs.",
  INVALID_GENRES: "Pick one to three genres.",
  UNSUPPORTED_LINK: "Use an https link from SoundCloud, Audiomack, YouTube, Bandcamp, Apple Music, Spotify or TIDAL.",
  SPOTIFY_NOT_LINKED: "Connect Spotify first.",
  SPOTIFY_UNAVAILABLE: "Saving to Spotify isn't set up yet.",
  CHART_EMPTY: "Nothing has charted this week yet.",
  NOT_AN_ARTIST: "Only verified artists can challenge other artists.",
  ARTIST_TAKEN: "That artist already has a verified profile.",
  KIND_MISMATCH: "Singles face singles; albums and EPs face albums and EPs.",
  NOT_YOUR_RELEASE: "Pick one of your own releases.",
  RANKED_NO_BOT: "Ranked battles are against people only.",
  TOURNAMENT_OVER: "This tournament is over.",
  INVALID_SIZE: "Pick 8 or 16 different songs.",
  PRO_REQUIRED: "This course is part of VYBZ Pro.",
  PRO_NOT_CONFIGURED: "Subscriptions aren't set up yet.",
  SUBSCRIPTION_IN_USE: "This subscription belongs to another VYBZ account.",
  INVALID_PURCHASE: "That isn't a VYBZ Pro purchase.",
  APPLE_UNAVAILABLE: "Couldn't reach the App Store. Try again in a moment.",
  APPLE_MUSIC_UNAVAILABLE: "Apple Music isn't available right now.",
  INVALID_TOKEN: "Apple Music didn't accept that. Try connecting again.",
  INVALID_PAIR: "Those two can't be matched up.",
  MIXTAPE_EXISTS: "That mixtape has already been submitted.",
  INVALID_MIXTAPE: "Add the mixtape's title and artist.",
  TOO_MANY_ARTISTS: "You're following the most artists you can.",
  WAR_CLOSED: "Voting has closed on this war.",
  BATTLE_SET_RULES: "Battle sets run 30 seconds to 3 minutes and use VYBZ pack tracks only.",
  ALREADY_CLAIMED: "You've claimed today's reward. Come back tomorrow.",
  VOTING_CLOSED: "Voting has closed for this round.",
  HANDLE_TAKEN: "That handle is taken.",
  TRACK_OUTSIDE_GENRE: "That track isn't in this battle's genre.",
  WRONG_TRACK_COUNT: "Pick the agreed number of tracks for this round.",
  DUPLICATE_TRACK: "Pick different tracks.",
  NOT_YOUR_TURN: "Waiting for the other side to answer your terms.",
  NO_CHANGES: "Change at least one term to send a counter-offer.",
  TOO_MANY_COUNTERS: "Too many counter-offers. Accept the terms or walk away.",
  AI_JUDGE_UNAVAILABLE: "AI judging isn't available on this server.",
  AI_JUDGED: "The AI judge decides this battle.",
  INVALID_TIER: "That playback option isn't available on this device.",
  BATTLE_FULL: "This battle is full.",
  ALREADY_JOINED: "You're already in this battle.",
  NOT_ENOUGH_ENTRANTS: "Not enough players have joined yet.",
  NOT_A_CONTENDER: "This sudden-death round is for the tied leaders.",
  SLOW_DOWN: "Slow down a little.",
  MESSAGE_BLOCKED: "That message breaks the chat rules.",
  CHAT_CLOSED: "Chat is closed for this battle.",
  NOT_FOUND: "This battle doesn't exist or is private.",
  FORBIDDEN: "You don't have permission to do that.",
  CATALOG_UNAVAILABLE: "That catalog isn't available.",
  NO_PROVIDERS_CONFIGURED: "Music search isn't set up on the server yet.",
  ARTIST_NOT_FOUND: "That artist isn't available.",
  PROVIDER_ERROR: "The music service didn't answer. Try again in a moment.",
  NOT_PARTICIPANT: "Only players in this battle can do that.",
  NOT_IN_PROGRESS: "This battle isn't live right now.",
  ROUND_NOT_CURRENT: "That round has moved on. Pull down to refresh.",
  TRACK_TOO_LONG: "That track is longer than this battle allows.",
  TRACK_NOT_FOUND: "That song isn't available anymore. Pick another.",
  INVALID_CATALOG_ID: "That song can't be used. Pick another.",
  PROVIDER_UNAVAILABLE: "That music service isn't available right now. Try the other one.",
  NOT_CREATOR: "Only the person who made this battle can do that.",
  NOT_A_DUEL: "That only works in a 1-vs-1 battle.",
  NOT_MULTI: "That only works in a group battle.",
  INVALID_TERMS: "Those terms aren't valid. Check them and try again.",
  INVALID_ROUND: "That round doesn't exist.",
  INVALID_REQUEST: "Something about that request wasn't right. Try again.",
  BAD_ORIGIN: "Request blocked for security. Update the app and try again.",
  LISTEN_REQUIRED: "Listen to every entry before voting.",
  UNKNOWN_SUBMISSION: "That entry isn't in this round.",
  NOT_OWNER: "Only the playlist's owner can do that.",
  NOT_CONNECTED: "You can message people once one of you follows the other.",
  BLOCKED: "You can't interact with this person.",
  INVALID_TEXT: "That's empty or too long.",
  PLAYLIST_NOT_PUBLIC: "Make the playlist public to share it in the feed.",
  BATTLE_NOT_PUBLIC: "Only public battles can be shared in the feed.",
  TOO_MANY_FOLLOWS: "You follow the maximum number of people.",
  ALREADY_IN_PLAYLIST: "That song is already in this playlist.",
  PLAYLIST_FULL: "This playlist is full.",
  ORDER_MISMATCH: "The playlist changed. Pull down to refresh.",
  TOO_MANY_PLAYLISTS: "You have the maximum number of playlists.",
  TOO_MANY_COLLABORATORS: "This playlist has the maximum number of collaborators.",
};

export function describeError(code: string, status = 0): string {
  // Unknown codes show their name, so a screenshot is enough to tell what happened.
  return MESSAGES[code] ?? (status >= 500 ? `Something went wrong on our side (${code || status}). Try again.` : `That didn't work (${code || status}). Try again.`);
}

export const api = {
  me: () => request<MeView>("GET", "/api/v1/me"),
  updateMe: (body: { handle?: string; displayName?: string }) => request<MeView>("PATCH", "/api/v1/me", body),
  battles: (feed: BattleFeed) => request<BattleListResponse>("GET", `/api/v1/battles?feed=${feed}`),
  battle: (id: string, code?: string | null) =>
    request<BattleView>("GET", `/api/v1/battles/${encodeURIComponent(id)}${code ? `?code=${encodeURIComponent(code)}` : ""}`),
  createBattle: (body: CreateBattleRequest) => request<{ id: string }>("POST", "/api/v1/battles", body),
  accept: (id: string, code?: string | null) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/accept`, code ? { code } : {}),
  join: (id: string, code?: string | null) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/join`, code ? { code } : {}),
  leave: (id: string) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/leave`),
  start: (id: string) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/start`),
  heart: (id: string, round: number, submissionId: string, hearted: boolean) =>
    request<null>("POST", `/api/v1/battles/${encodeURIComponent(id)}/rounds/${round}/heart`, { submissionId, hearted }),
  live: (id: string, after?: string | null) =>
    request<LiveView>("GET", `/api/v1/battles/${encodeURIComponent(id)}/live${after ? `?after=${encodeURIComponent(after)}` : ""}`),
  chat: (id: string, body: string, gif?: GifView) => request<ChatMessageView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/chat`, { body, ...(gif ? { gif } : {}) }),
  likeChat: (id: string, messageId: string, liked: boolean) =>
    request<{ likes: number; liked: boolean }>("POST", `/api/v1/battles/${encodeURIComponent(id)}/chat/${encodeURIComponent(messageId)}/like`, { liked }),
  react: (id: string, emoji: Reaction) => request<null>("POST", `/api/v1/battles/${encodeURIComponent(id)}/react`, { emoji }),
  presence: (id: string) => request<null>("POST", `/api/v1/battles/${encodeURIComponent(id)}/presence`),
  feature: (id: string, featured: boolean) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/feature`, { featured }),
  voidBattle: (id: string, note?: string) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/void`, note ? { note } : {}),
  notifications: () => request<NotificationsResponse>("GET", "/api/v1/notifications"),
  markRead: (ids: string[] | "all") => request<null>("POST", "/api/v1/notifications/read", ids === "all" ? { all: true } : { ids }),
  registerPush: (token: string, platform: string) => request<null>("POST", "/api/v1/push-tokens", { token, platform }),
  report: (body: ReportRequest) => request<{ id: string }>("POST", "/api/v1/reports", body),
  modReports: (status: "OPEN" | "ACTIONED" | "DISMISSED" = "OPEN") => request<{ items: ModerationReportView[] }>("GET", `/api/v1/mod/reports?status=${status}`),
  resolveReport: (id: string, action: ModerationAction, note?: string) =>
    request<null>("POST", `/api/v1/mod/reports/${encodeURIComponent(id)}`, { action, ...(note ? { note } : {}) }),
  hideMessage: (id: string) => request<null>("POST", `/api/v1/mod/messages/${encodeURIComponent(id)}/hide`),
  decline: (id: string) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/decline`),
  importPlaylist: (url: string) => request<ImportPlaylistResponse>("POST", "/api/v1/playlists/import", { url }),
  quickBattle: (body: QuickBattleRequest) => request<QuickBattleResponse>("POST", "/api/v1/quick-battle", body),
  cancel: (id: string) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/cancel`),
  rematch: (id: string) => request<{ id: string }>("POST", `/api/v1/battles/${encodeURIComponent(id)}/rematch`),
  submit: (id: string, round: number, catalogIds: string[]) =>
    request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/rounds/${round}/submit`, { catalogIds }),
  counter: (id: string, rules: BattleRulesInput) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/counter`, { rules }),
  config: () => request<ConfigResponse>("GET", "/api/v1/config"),
  listen: (id: string, round: number, body: ListenRequest) =>
    request<{ playedMs: number; requiredMs: number }>("POST", `/api/v1/battles/${encodeURIComponent(id)}/rounds/${round}/listen`, body),
  vote: (id: string, round: number, submissionId: string) =>
    request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/rounds/${round}/vote`, { submissionId }),
  artists: (q: string) => request<ArtistSearchResponse>("GET", `/api/v1/catalog/artists?q=${encodeURIComponent(q)}`),
  artist: (artistId: string) => request<ArtistDetailResponse>("GET", `/api/v1/catalog/artists/${encodeURIComponent(artistId)}`),
  suggestions: (t: { genres?: readonly string[] | undefined; eraFrom?: number | undefined; eraTo?: number | undefined }) => {
    const qs = new URLSearchParams({ genres: (t.genres ?? []).join(",") });
    if (t.eraFrom !== undefined) qs.set("eraFrom", String(t.eraFrom));
    if (t.eraTo !== undefined) qs.set("eraTo", String(t.eraTo));
    return request<SuggestionsResponse>("GET", `/api/v1/catalog/suggestions?${qs}`);
  },
  library: () => request<LibraryResponse>("GET", "/api/v1/library"),
  save: (song: { catalogId: string } | { trackId: string }) => request<{ trackId: string }>("POST", "/api/v1/library", song),
  unsave: (trackId: string) => request<null>("DELETE", `/api/v1/library/${encodeURIComponent(trackId)}`),
  playlists: (scope: "mine" | "public" | { handle: string } = "mine") =>
    request<PlaylistListResponse>("GET", `/api/v1/playlists?${typeof scope === "string" ? `scope=${scope}` : `scope=user&handle=${encodeURIComponent(scope.handle)}`}`),
  playlist: (id: string, code?: string | null) => request<PlaylistView>("GET", `/api/v1/playlists/${encodeURIComponent(id)}${code ? `?code=${encodeURIComponent(code)}` : ""}`),
  createPlaylist: (body: CreatePlaylistRequest) => request<{ id: string }>("POST", "/api/v1/playlists", body),
  updatePlaylist: (id: string, body: { title?: string; description?: string | null; visibility?: "PUBLIC" | "PRIVATE" }) =>
    request<PlaylistView>("PATCH", `/api/v1/playlists/${encodeURIComponent(id)}`, body),
  deletePlaylist: (id: string) => request<null>("DELETE", `/api/v1/playlists/${encodeURIComponent(id)}`),
  addToPlaylist: (id: string, song: { catalogId: string } | { trackId: string }) => request<{ trackId: string }>("POST", `/api/v1/playlists/${encodeURIComponent(id)}/tracks`, song),
  removeFromPlaylist: (id: string, trackId: string) => request<null>("DELETE", `/api/v1/playlists/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`),
  reorderPlaylist: (id: string, trackIds: string[]) => request<null>("PUT", `/api/v1/playlists/${encodeURIComponent(id)}/order`, { trackIds }),
  addCollaborator: (id: string, handle: string) => request<null>("POST", `/api/v1/playlists/${encodeURIComponent(id)}/collaborators`, { handle }),
  removeCollaborator: (id: string, userId: string) => request<null>("DELETE", `/api/v1/playlists/${encodeURIComponent(id)}/collaborators/${encodeURIComponent(userId)}`),
  feed: (kind: "following" | "for_you" | { handle: string }, before?: string | null) =>
    request<FeedResponse>(
      "GET",
      `/api/v1/feed?${typeof kind === "string" ? `kind=${kind}` : `kind=user&handle=${encodeURIComponent(kind.handle)}`}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
    ),
  createPost: (body: CreatePostRequest) => request<{ id: string }>("POST", "/api/v1/posts", body),
  post: (id: string) => request<PostDetailResponse>("GET", `/api/v1/posts/${encodeURIComponent(id)}`),
  deletePost: (id: string) => request<null>("DELETE", `/api/v1/posts/${encodeURIComponent(id)}`),
  like: (id: string, liked: boolean) => request<null>("POST", `/api/v1/posts/${encodeURIComponent(id)}/like`, { liked }),
  comment: (id: string, body: string, gif?: GifView) => request<CommentView>("POST", `/api/v1/posts/${encodeURIComponent(id)}/comments`, { body, ...(gif ? { gif } : {}) }),
  likeComment: (commentId: string, liked: boolean) => request<{ likes: number; liked: boolean }>("POST", `/api/v1/comments/${encodeURIComponent(commentId)}/like`, { liked }),
  deleteComment: (id: string) => request<null>("DELETE", `/api/v1/comments/${encodeURIComponent(id)}`),
  follow: (handle: string) => request<null>("POST", `/api/v1/users/${encodeURIComponent(handle)}/follow`),
  unfollow: (handle: string) => request<null>("DELETE", `/api/v1/users/${encodeURIComponent(handle)}/follow`),
  block: (handle: string) => request<null>("POST", `/api/v1/users/${encodeURIComponent(handle)}/block`),
  unblock: (handle: string) => request<null>("DELETE", `/api/v1/users/${encodeURIComponent(handle)}/block`),
  daily: () => request<DailyRewardState>("GET", `/api/v1/me/daily?tz=${encodeURIComponent(timeZone())}`),
  claimDaily: () => request<DailyClaimResponse>("POST", "/api/v1/me/daily", { timeZone: timeZone() }),
  wallet: (cursor?: string | null) => request<WalletResponse>("GET", `/api/v1/me/wallet${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  shop: () => request<ShopResponse>("GET", "/api/v1/me/shop"),
  buy: (item: string) => request<ShopResponse>("POST", "/api/v1/me/shop", { item }),
  equipFrame: (frame: string | null) => request<ShopResponse>("PUT", "/api/v1/me/shop", { frame }),
  progress: (handle: string) => request<ProgressView>("GET", `/api/v1/users/${encodeURIComponent(handle)}/progress`),
  achievements: (handle: string) => request<AchievementsResponse>("GET", `/api/v1/users/${encodeURIComponent(handle)}/achievements`),
  followList: (handle: string, which: "followers" | "following") => request<UserListResponse>("GET", `/api/v1/users/${encodeURIComponent(handle)}/${which}`),
  peopleSuggestions: () => request<{ items: PeopleSuggestion[] }>("GET", "/api/v1/people/suggestions"),
  inbox: () => request<InboxResponse>("GET", "/api/v1/messages"),
  openConversation: (handle: string) => request<{ id: string }>("POST", "/api/v1/messages", { handle }),
  conversation: (id: string) => request<ConversationView>("GET", `/api/v1/messages/${encodeURIComponent(id)}`),
  sendMessage: (id: string, body: string, gif?: GifView) => request<DirectMessageView>("POST", `/api/v1/messages/${encodeURIComponent(id)}`, { body, ...(gif ? { gif } : {}) }),
  deleteAccount: () => request<null>("POST", "/api/v1/me/delete", { confirm: "DELETE" }),
  search: (q: string, source?: ProviderKind) =>
    request<CatalogSearchResponse>("GET", `/api/v1/catalog/search?q=${encodeURIComponent(q)}${source ? `&source=${source}` : ""}`),
  rankings: () => request<RankingsResponse>("GET", "/api/v1/rankings"),
  leaderboard: (q: { scope: LeaderboardScope; genre?: string | null; period: LeaderboardPeriod; metric: LeaderboardMetric }) =>
    request<LeaderboardResponse>("GET", `/api/v1/leaderboards?scope=${q.scope}&period=${q.period}&metric=${q.metric}${q.genre ? `&genre=${q.genre}` : ""}`),
  profile: (handle: string) => request<ProfileView>("GET", `/api/v1/users/${encodeURIComponent(handle)}`),
  triviaHub: () => request<TriviaHubResponse>("GET", `/api/v1/trivia?tz=${encodeURIComponent(timeZone())}`),
  triviaStart: (body: { mode: "DAILY" } | { mode: "PRACTICE"; category: TriviaCategory; genre?: string | null }) =>
    request<TriviaPlayView>("POST", "/api/v1/trivia/plays", { ...body, tz: timeZone() }),
  triviaPlay: (id: string) => request<TriviaPlayView>("GET", `/api/v1/trivia/plays/${encodeURIComponent(id)}`),
  triviaAnswer: (id: string, questionId: string, choice: number | null) =>
    request<TriviaAnswerResult>("POST", `/api/v1/trivia/plays/${encodeURIComponent(id)}/answer`, { questionId, choice }),
  triviaLeaderboard: (period: TriviaLeaderboardPeriod, scope: "global" | "following") =>
    request<TriviaLeaderboardResponse>("GET", `/api/v1/trivia/leaderboard?period=${period}&scope=${scope}&tz=${encodeURIComponent(timeZone())}`),
  triviaFlag: (questionId: string, reason: string) => request<{ ok: true }>("POST", `/api/v1/trivia/questions/${encodeURIComponent(questionId)}/flag`, { reason }),
  modTrivia: (status: TriviaQuestionStatus | "FLAGGED", category?: TriviaCategory | null, q?: string) =>
    request<TriviaAdminList>("GET", `/api/v1/mod/trivia/questions?status=${status}${category ? `&category=${category}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  modTriviaCreate: (body: TriviaQuestionInput & { approve?: boolean }) => request<TriviaAdminQuestion>("POST", "/api/v1/mod/trivia/questions", body),
  modTriviaUpdate: (id: string, body: Partial<TriviaQuestionInput> & { status?: TriviaQuestionStatus }) =>
    request<TriviaAdminQuestion>("PATCH", `/api/v1/mod/trivia/questions/${encodeURIComponent(id)}`, body),
  modTriviaBulk: (ids: string[], status: "APPROVED" | "REJECTED" | "RETIRED") => request<{ updated: number }>("POST", "/api/v1/mod/trivia/bulk", { ids, status }),
  modTriviaGenerate: () => request<{ added: number }>("POST", "/api/v1/mod/trivia/generate", {}),
  djUniversity: () => request<DjUniversityResponse>("GET", "/api/v1/dj/university"),
  djLessonStep: (id: string, body: { step: "learn" | "demo" } | { step: "quiz"; answers: number[] }) =>
    request<DjLessonStepResult>("POST", `/api/v1/dj/lessons/${encodeURIComponent(id)}`, body),
  djSets: () => request<{ items: DjSetView[] }>("GET", "/api/v1/dj/sets"),
  djBattles: (status: "OPEN" | "VOTING" | "COMPLETE") => request<{ items: DjBattleView[] }>("GET", `/api/v1/dj/battles?status=${status}`),
  wars: (status: "OPEN" | "CLOSED", kind?: WarKind | null) => request<{ items: WarListItem[] }>("GET", `/api/v1/wars?status=${status}${kind ? `&kind=${kind}` : ""}`),
  war: (id: string) => request<WarView>("GET", `/api/v1/wars/${encodeURIComponent(id)}`),
  createWar: (kind: WarKind, a: string, b: string) => request<WarView>("POST", "/api/v1/wars", { kind, a, b }),
  voteWar: (id: string, category: string, side: "A" | "B") => request<WarView>("POST", `/api/v1/wars/${encodeURIComponent(id)}/vote`, { category, side }),
  warRankings: (kind: WarKind, period: WarPeriod) => request<WarRankingsResponse>("GET", `/api/v1/wars/rankings?kind=${kind}&period=${period}`),
  searchAlbums: (q: string) => request<{ items: AlbumHit[] }>("GET", `/api/v1/albums/search?q=${encodeURIComponent(q)}`),
  trendingAlbums: () => request<{ items: AlbumHit[] }>("GET", "/api/v1/albums/trending"),
  onboarding: () => request<OnboardingState>("GET", "/api/v1/me/onboarding"),
  today: () => request<TodayView>("GET", `/api/v1/me/today?tz=${encodeURIComponent(timeZone())}`),
  drops: (range: "today" | "week" | "following", kind: ReleaseKind | null, cursor?: string | null) =>
    request<DropsResponse>("GET", `/api/v1/drops?range=${range}${kind ? `&kind=${kind}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  fireDrop: (id: string, on: boolean) => request<ReleaseView>("POST", `/api/v1/drops/${id}/fire`, { on }),
  submitMixtape: (body: { title: string; artistName: string; url: string; note?: string }) => request<ReleaseView>("POST", "/api/v1/drops/mixtapes", body),
  myArtists: () => request<{ items: FollowedArtist[] }>("GET", "/api/v1/me/artists"),
  searchFollowArtists: (q: string) => request<{ items: ArtistFollowHit[] }>("GET", `/api/v1/artists/search?q=${encodeURIComponent(q)}`),
  followArtist: (body: { releaseId: string } | { provider: string; externalId: string; name: string; artworkUrl?: string | null }) =>
    request<{ items: FollowedArtist[] }>("POST", "/api/v1/me/artists", body),
  unfollowArtist: (body: { externalId: string } | { name: string }) => request<{ items: FollowedArtist[] }>("DELETE", "/api/v1/me/artists", body),
  modMixtapes: () => request<{ items: (ReleaseView & { note: string | null })[] }>("GET", "/api/v1/mod/mixtapes"),
  modReviewMixtape: (id: string, action: "approve" | "reject") => request<{ ok: true }>("POST", `/api/v1/mod/mixtapes/${id}`, { action }),
  out: (service: "spotify" | "apple" | "youtube" | "source", kind: "release" | "war" | "track", id: string, side?: "A" | "B") =>
    request<{ url: string }>("POST", "/api/v1/out", { service, kind, id, ...(side ? { side } : {}) }),
  verdictPair: () => request<{ pair: VerdictPair | null }>("GET", "/api/v1/verdict"),
  judge: (a: string, b: string, winner: string) => request<{ next: VerdictPair | null }>("POST", "/api/v1/verdict", { a, b, winner }),
  chart: (week?: string | null) => request<ChartResponse>("GET", `/api/v1/chart${week ? `?week=${encodeURIComponent(week)}` : ""}`),
  chartToSpotify: (week: string) => request<{ url: string; added: number }>("POST", "/api/v1/chart/spotify", { week }),
  modMetrics: () => request<MetricsResponse>("GET", "/api/v1/mod/metrics"),
  artistPage: (name: string) => request<ArtistPage>("GET", `/api/v1/artists/page?name=${encodeURIComponent(name)}`),
  myArtistProfile: () => request<{ profile: ArtistProfileView | null; code: string }>("GET", "/api/v1/me/artist-profile"),
  claimArtistProfile: (body: { name?: string; code?: string; proofUrl?: string; bio?: string; links?: Record<string, string> }) => request<ArtistProfileView>("POST", "/api/v1/me/artist-profile", body),
  challengeArtist: (mine: string, theirs: string) => request<WarView>("POST", "/api/v1/artist-challenges", { mine, theirs }),
  modArtists: () => request<{ items: ArtistProfileView[] }>("GET", "/api/v1/mod/artists"),
  modReviewArtist: (id: string, action: "verify" | "reject") => request<{ ok: true }>("POST", `/api/v1/mod/artists/${id}`, { action }),
  ranked: () => request<RankedResponse>("GET", "/api/v1/ranked"),
  tournaments: () => request<{ items: TournamentListItem[] }>("GET", "/api/v1/tournaments"),
  tournament: (id: string) => request<TournamentView>("GET", `/api/v1/tournaments/${encodeURIComponent(id)}`),
  voteTournament: (id: string, match: number, entry: number) => request<TournamentView>("POST", `/api/v1/tournaments/${encodeURIComponent(id)}/vote`, { match, entry }),
  createTournament: (body: { title: string; description?: string; catalogIds: string[] }) => request<TournamentView>("POST", "/api/v1/tournaments", body),
  pro: () => request<ProStatus>("GET", "/api/v1/me/pro"),
  claimPro: (transactionId: string) => request<ProStatus>("POST", "/api/v1/me/pro/claim", { transactionId }),
  djLesson: (id: string) => request<DjLesson>("GET", `/api/v1/dj/lessons/${encodeURIComponent(id)}`),
  topDrops: () => request<TopDropsResponse>("GET", "/api/v1/drops/top"),
  musicLink: () => request<MusicLinkStatus>("GET", "/api/v1/me/music"),
  appleDeveloperToken: () => request<{ token: string }>("GET", "/api/v1/me/music/apple/developer-token"),
  linkAppleMusic: (userToken: string) => request<MusicLinkStatus>("POST", "/api/v1/me/music/apple", { userToken }),
  unlinkAppleMusic: () => request<MusicLinkStatus>("DELETE", "/api/v1/me/music/apple"),
  modRunDrops: () => request<{ ran: boolean; added: number; note: string }>("POST", "/api/v1/mod/drops/run", {}),
  updateOnboarding: (body: { genres: string[] } | { action: "skip" }) => request<OnboardingState>("POST", "/api/v1/me/onboarding", body),
  modTriviaDraft: (category: "GENRE" | "ARTIST" | "HISTORY", genre: string | null, count: number) =>
    request<{ added: number; skipped: number }>("POST", "/api/v1/mod/trivia/draft", { category, genre, count }),
};
