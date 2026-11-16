import type {
  ApiError,
  BattleFeed,
  BattleListResponse,
  BattleRulesInput,
  BattleView,
  CatalogSearchResponse,
  ConfigResponse,
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

async function request<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Lets the server offer full Apple Music tracks to subscribers on this device.
  if (appleMusicFullEnabled()) headers["X-VYBZ-Apple-Music"] = "full";
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
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (json ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(res.status, err.error ?? "ERROR", err.message ?? describeError(err.error ?? "", res.status));
  }
  return json as T;
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
  TRACK_YEAR_UNKNOWN: "This battle has an era rule and that track has no release year.",
  TRACK_NOT_PLAYABLE: "That track can't be played for everyone. Try another version.",
  ROUND_NOT_ACCEPTING_SUBMISSIONS: "Picks are closed for this round.",
  ALREADY_SUBMITTED: "You already picked for this round.",
  ALREADY_VOTED: "You already voted this round.",
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
  CATALOG_UNAVAILABLE: "That catalog isn't available.",
  NO_PROVIDERS_CONFIGURED: "Music search isn't set up on the server yet.",
};

export function describeError(code: string, status = 0): string {
  return MESSAGES[code] ?? (status >= 500 ? "Something went wrong on our side. Try again." : "That didn't work. Try again.");
}

export const api = {
  me: () => request<MeView>("GET", "/api/v1/me"),
  updateMe: (body: { handle?: string; displayName?: string }) => request<MeView>("PATCH", "/api/v1/me", body),
  battles: (feed: BattleFeed) => request<BattleListResponse>("GET", `/api/v1/battles?feed=${feed}`),
  battle: (id: string) => request<BattleView>("GET", `/api/v1/battles/${encodeURIComponent(id)}`),
  createBattle: (body: CreateBattleRequest) => request<{ id: string }>("POST", "/api/v1/battles", body),
  accept: (id: string) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/accept`),
  decline: (id: string) => request<BattleView>("POST", `/api/v1/battles/${encodeURIComponent(id)}/decline`),
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
  search: (q: string, source?: ProviderKind) =>
    request<CatalogSearchResponse>("GET", `/api/v1/catalog/search?q=${encodeURIComponent(q)}${source ? `&source=${source}` : ""}`),
  rankings: () => request<RankingsResponse>("GET", "/api/v1/rankings"),
  profile: (handle: string) => request<ProfileView>("GET", `/api/v1/users/${encodeURIComponent(handle)}`),
};
