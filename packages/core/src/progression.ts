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
  | "playlists";

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
