/**
 * Ranked mode: Elo ratings from ranked quick battles (human against human,
 * never the bot), divisions, and quarterly seasons with a soft reset.
 */

export const RANKED = {
  start: 1000,
  /** K-factor; placement games move ratings faster. */
  k: 32,
  placementK: 48,
  placementGames: 5,
  /** Matchmaking window: ±base, widening per minute of waiting, up to max. */
  windowBase: 150,
  windowPerMinute: 50,
  windowMax: 400,
} as const;

export const DIVISIONS = [
  { key: "BRONZE", label: "Bronze", icon: "🥉", min: 0 },
  { key: "SILVER", label: "Silver", icon: "🥈", min: 1050 },
  { key: "GOLD", label: "Gold", icon: "🥇", min: 1150 },
  { key: "PLATINUM", label: "Platinum", icon: "💠", min: 1250 },
  { key: "DIAMOND", label: "Diamond", icon: "💎", min: 1350 },
  { key: "LEGEND", label: "Legend", icon: "👑", min: 1450 },
] as const;
export type DivisionKey = (typeof DIVISIONS)[number]["key"];

export function divisionOf(rating: number): (typeof DIVISIONS)[number] {
  let d: (typeof DIVISIONS)[number] = DIVISIONS[0];
  for (const x of DIVISIONS) if (rating >= x.min) d = x;
  return d;
}

/** "2026-Q4" */
export function seasonOf(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** New season: halfway back to the start. */
export function softReset(rating: number): number {
  return Math.round((rating + RANKED.start) / 2);
}

/** Elo change for A given A's score (1 win, 0.5 draw, 0 loss). */
export function eloDelta(ratingA: number, ratingB: number, scoreA: number, k: number = RANKED.k): number {
  const expected = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  return Math.round(k * (scoreA - expected));
}

export function matchWindow(waitingMs: number): number {
  return Math.min(RANKED.windowMax, RANKED.windowBase + Math.floor(waitingMs / 60_000) * RANKED.windowPerMinute);
}

export interface RankView {
  season: string;
  rating: number;
  peak: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  division: DivisionKey;
  divisionLabel: string;
  icon: string;
  /** Still in placement games. */
  placement: boolean;
  /** Points to the next division, null at the top. */
  toNext: number | null;
}

export interface RankedBoardRow {
  rank: number;
  user: { handle: string; displayName: string; image: string | null };
  rating: number;
  division: DivisionKey;
  icon: string;
  games: number;
  wins: number;
}

export interface RankedResponse {
  season: string;
  me: RankView | null;
  /** Your handle, for sharing your rank card. */
  meHandle: string | null;
  top: RankedBoardRow[];
  divisions: { key: DivisionKey; label: string; icon: string; min: number }[];
}

// ── Tournaments ────────────────────────────────────────────────────────────

export const TOURNAMENT = {
  sizes: [8, 16] as const,
  /** Each round's voting window. 16 songs: 4 rounds ≈ a week. */
  roundHours: 42,
  voteXp: 1,
  voteXpPerDay: 15,
} as const;

export interface TournamentEntry {
  catalogId: string;
  trackId: string;
  title: string;
  artistName: string;
  artworkUrl: string | null;
  previewUrl: string | null;
  externalUrl: string | null;
}

export interface TournamentMatch {
  index: number;
  a: number;
  b: number;
  /** Shown once you've voted in it, or after the round ends. */
  votesA: number | null;
  votesB: number | null;
  winner: number | null;
  mine: number | null;
}

export interface TournamentView {
  id: string;
  title: string;
  description: string | null;
  status: "LIVE" | "DONE";
  entries: TournamentEntry[];
  /** Every round so far, the current one last. */
  rounds: { name: string; matches: TournamentMatch[]; done: boolean }[];
  round: number;
  roundEndsAt: string;
  champion: number | null;
  voters: number;
  creator: { handle: string };
}

export interface TournamentListItem {
  id: string;
  title: string;
  status: "LIVE" | "DONE";
  size: number;
  roundName: string;
  roundEndsAt: string;
  champion: { title: string; artistName: string; artworkUrl: string | null } | null;
  voters: number;
  artwork: (string | null)[];
}

export function roundName(size: number, round: number): string {
  const left = size / 2 ** round;
  return left === 2 ? "Final" : left === 4 ? "Semifinals" : left === 8 ? "Quarterfinals" : `Round of ${left}`;
}

/** Standard seeding: 1 v N, then the bracket order that keeps top seeds apart. */
export function bracketOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n - 1 - s]);
  }
  return order;
}
