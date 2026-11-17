/**
 * Progression: achievements, daily rewards, streaks, levels, XP and coins.
 * The catalog and the rules live here so the server and the apps agree.
 */

// ── Achievements ───────────────────────────────────────────────────────────

export type AchievementMetric =
  | "battlesPlayed"
  | "battlesWon"
  | "roundsWon"
  | "flawlessWins"
  | "genresWon"
  | "dailyPlayed"
  | "votesCast"
  | "posts"
  | "followers"
  | "playlists"
  | "bestWinStreak"
  | "bestDailyStreak"
  | "bestPlayStreak";

export interface AchievementDef {
  code: string;
  title: string;
  description: string;
  icon: string;
  metric: AchievementMetric;
  target: number;
  /** Granted once, when unlocked. */
  xp: number;
  coins: number;
}

const a = (code: string, icon: string, title: string, description: string, metric: AchievementMetric, target: number, xp: number, coins: number): AchievementDef => ({
  code,
  icon,
  title,
  description,
  metric,
  target,
  xp,
  coins,
});

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  a("first_battle", "🎧", "First spin", "Finish your first battle.", "battlesPlayed", 1, 25, 10),
  a("battles_10", "📀", "Regular", "Finish 10 battles.", "battlesPlayed", 10, 75, 25),
  a("battles_50", "🏟️", "Veteran", "Finish 50 battles.", "battlesPlayed", 50, 250, 100),
  a("first_win", "🏆", "First win", "Win a battle.", "battlesWon", 1, 50, 15),
  a("wins_10", "🔥", "Hot hand", "Win 10 battles.", "battlesWon", 10, 150, 50),
  a("wins_50", "👑", "Crowned", "Win 50 battles.", "battlesWon", 50, 500, 200),
  a("rounds_25", "🎯", "Round taker", "Win 25 rounds.", "roundsWon", 25, 100, 30),
  a("flawless", "💎", "Flawless", "Win a battle without dropping a round.", "flawlessWins", 1, 75, 25),
  a("genre_hopper", "🌍", "Genre hopper", "Win battles in 3 different genres.", "genresWon", 3, 100, 40),
  a("daily_player", "📅", "Daily devotee", "Finish 5 daily battles.", "dailyPlayed", 5, 100, 40),
  a("voter_10", "🗳️", "Judge", "Vote in 10 rounds.", "votesCast", 10, 40, 10),
  a("voter_100", "⚖️", "Chief justice", "Vote in 100 rounds.", "votesCast", 100, 200, 75),
  a("first_post", "✍️", "On the record", "Share your first post.", "posts", 1, 20, 5),
  a("followers_10", "📣", "Following", "Get 10 followers.", "followers", 10, 100, 40),
  a("curator", "🗂️", "Curator", "Make 3 playlists.", "playlists", 3, 40, 15),
  a("win_streak_3", "⚡", "On a roll", "Win 3 battles in a row.", "bestWinStreak", 3, 100, 40),
  a("win_streak_5", "🌪️", "Unstoppable", "Win 5 battles in a row.", "bestWinStreak", 5, 200, 80),
  a("daily_7", "🗓️", "Every day", "Claim your daily reward 7 days in a row.", "bestDailyStreak", 7, 100, 50),
  a("play_7", "🎚️", "In the booth", "Finish a battle 7 days in a row.", "bestPlayStreak", 7, 150, 60),
];

export function achievementDef(code: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((d) => d.code === code);
}

export interface AchievementView {
  code: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  /** Capped at target. */
  progress: number;
  xp: number;
  coins: number;
  unlockedAt: string | null;
}

export interface AchievementsResponse {
  items: AchievementView[];
  unlocked: number;
  total: number;
}

// ── Daily rewards ──────────────────────────────────────────────────────────

export interface Reward {
  xp: number;
  coins: number;
}

/** Claim on consecutive days to climb; day 7 is the big one, then it starts over. */
export const DAILY_LADDER: readonly Reward[] = [
  { xp: 10, coins: 5 },
  { xp: 15, coins: 5 },
  { xp: 20, coins: 10 },
  { xp: 25, coins: 10 },
  { xp: 30, coins: 15 },
  { xp: 40, coins: 20 },
  { xp: 75, coins: 50 },
];

/** 1–7: where a claim on consecutive day `streakDay` lands on the ladder. */
export function ladderDay(streakDay: number): number {
  return ((Math.max(1, streakDay) - 1) % DAILY_LADDER.length) + 1;
}

export interface DailyRewardState {
  /** Today in your time zone, YYYY-MM-DD. */
  today: string;
  claimedToday: boolean;
  /** False once today is claimed (or, after a time-zone change, until a few hours have passed). */
  canClaim: boolean;
  /** Consecutive days claimed, counting today if claimed (or yesterday if today is still open). */
  streak: number;
  /** 1–7: the ladder step today's claim is (or was). */
  ladderDay: number;
  /** Today's reward: what you'll get, or what you got. */
  reward: Reward;
  ladder: Reward[];
  balance: Reward;
}

export interface DailyClaimResponse {
  reward: Reward;
  state: DailyRewardState;
}

// ── Streaks ────────────────────────────────────────────────────────────────

export interface Streak {
  current: number;
  best: number;
}

export interface Streaks {
  /** Daily rewards claimed on consecutive days. */
  daily: Streak;
  /** Battles won in a row (a loss or a draw ends it). */
  wins: Streak;
  /** Consecutive days with at least one finished battle. */
  play: Streak;
}

/** Longest and trailing runs of consecutive YYYY-MM-DD days; the trailing run only counts if it reaches yesterday or today. */
export function dayRuns(days: string[], today: string): Streak {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && nextDay(prev) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const alive = prev !== null && (prev === today || nextDay(prev) === today);
  return { current: alive ? run : 0, best };
}

/** Runs of `true` in order; the trailing run is current. */
export function boolRuns(results: boolean[]): Streak {
  let best = 0;
  let run = 0;
  for (const r of results) {
    run = r ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current: run, best };
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Someone's progression at a glance (profiles, Home). */
export interface ProgressView {
  streaks: Streaks;
}
