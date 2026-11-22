import { weekStart } from "./drops";

/**
 * Weekly leagues. Every week, players who earn XP are put in a group of up
 * to 30 at their league tier and ranked by the XP they earn that week. When
 * the week ends (Monday 00:00 UTC) the top of each group moves up a tier and
 * the bottom moves down. Ranked seasons (quarterly, Elo) sit alongside this:
 * leagues reward showing up; Ranked rewards winning.
 */

export const LEAGUES = [
  { key: "OPENER", label: "Opening Act", icon: "🎙️" },
  { key: "MIXTAPE", label: "Mixtape", icon: "📼" },
  { key: "SINGLE", label: "Single", icon: "🎵" },
  { key: "ALBUM", label: "Album", icon: "💿" },
  { key: "GOLD", label: "Gold Record", icon: "🥇" },
  { key: "PLATINUM", label: "Platinum Record", icon: "🏆" },
  { key: "DIAMOND", label: "Diamond Record", icon: "💎" },
] as const;
export type LeagueKey = (typeof LEAGUES)[number]["key"];

export const LEAGUE = {
  groupSize: 30,
  /** Top this many move up… */
  promote: 7,
  /** …bottom this many move down, in groups at least `minForDemotion` big. */
  demote: 5,
  minForDemotion: 10,
  /** Smaller groups: only the top few move up. */
  smallGroupPromote: 3,
} as const;

export type LeagueOutcome = "PROMOTED" | "DEMOTED" | "STAYED";

/** Monday 00:00 UTC that starts the week containing `d`, and the next one. */
export function weekBounds(d: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

/** Start and end of a named ISO week. */
export function namedWeekBounds(week: string): { start: Date; end: Date } {
  const start = weekStart(week);
  return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

/** Where a 1-based rank in a group of `size` lands at the week's end. Nobody leaves the bottom or top tier. */
export function leagueOutcome(rank: number, size: number, tier: number, xp: number): LeagueOutcome {
  const top = LEAGUES.length - 1;
  const promote = size >= LEAGUE.minForDemotion ? LEAGUE.promote : LEAGUE.smallGroupPromote;
  // You have to have played that week to move up.
  if (tier < top && xp > 0 && rank <= promote) return "PROMOTED";
  if (tier > 0 && size >= LEAGUE.minForDemotion && rank > size - LEAGUE.demote) return "DEMOTED";
  return "STAYED";
}

/** The tier after a week's outcome. */
export function nextTier(tier: number, outcome: LeagueOutcome | null): number {
  const t = outcome === "PROMOTED" ? tier + 1 : outcome === "DEMOTED" ? tier - 1 : tier;
  return Math.max(0, Math.min(LEAGUES.length - 1, t));
}

export interface LeagueStanding {
  rank: number;
  user: { id: string; handle: string; displayName: string; image: string | null };
  xp: number;
  zone: "UP" | "DOWN" | null;
  me: boolean;
}

export interface LeagueView {
  week: string;
  endsAt: string;
  tier: number;
  league: { key: LeagueKey; label: string; icon: string };
  /** Null until you earn XP this week. */
  standings: LeagueStanding[] | null;
  myRank: number | null;
  /** Last week's result, to celebrate or console. */
  last: { week: string; tier: number; outcome: LeagueOutcome; rank: number } | null;
  /** Ranked season badges, newest first. */
  badges: { season: string; division: string; label: string; icon: string }[];
}
