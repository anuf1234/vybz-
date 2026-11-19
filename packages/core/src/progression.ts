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
  | "bestPlayStreak"
  | "level"
  | "triviaDaily"
  | "triviaPerfect"
  | "triviaCorrect"
  | "bestTriviaStreak"
  | "djLessons"
  | "djBattleWins";

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
  a("trivia_first", "🧠", "Quiz night", "Finish your first daily trivia.", "triviaDaily", 1, 20, 5),
  a("trivia_perfect", "💯", "Perfect 10", "Get all 10 right in a daily trivia.", "triviaPerfect", 1, 100, 40),
  a("trivia_streak_7", "📚", "Daily scholar", "Play daily trivia 7 days in a row.", "bestTriviaStreak", 7, 120, 50),
  a("trivia_30", "🎓", "Music professor", "Finish 30 daily trivia games.", "triviaDaily", 30, 250, 100),
  a("trivia_correct_250", "🗃️", "Encyclopedia", "Answer 250 trivia questions correctly.", "triviaCorrect", 250, 200, 75),
  a("dj_first_lesson", "🎧", "First lesson", "Complete a DJ University lesson.", "djLessons", 1, 20, 5),
  a("dj_graduate", "🎓", "DJ graduate", "Complete all 11 DJ University lessons.", "djLessons", 11, 300, 150),
  a("dj_battle_win", "🎚️", "Spin to win", "Win a DJ battle.", "djBattleWins", 1, 100, 40),
  a("level_5", "⭐", "Rising", "Reach level 5.", "level", 5, 0, 50),
  a("level_10", "🌟", "Headliner", "Reach level 10.", "level", 10, 0, 100),
  a("level_25", "💫", "Legend", "Reach level 25.", "level", 25, 0, 250),
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
  /** Streak freezes held; one is used for each missed day when you next claim. */
  streakFreezes: number;
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
  /** Consecutive days with a finished daily trivia. */
  trivia: Streak;
  /** Consecutive days with any battle pick, vote, war vote, trivia game or fired-up drop (freezes count). */
  vybz: Streak;
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

// ── Levels ─────────────────────────────────────────────────────────────────

export const MAX_LEVEL = 100;

/** Total XP needed to reach `level`: 0, 100, 300, 600, 1000, … (50·L·(L−1)). */
export function xpForLevel(level: number): number {
  const l = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  return 50 * l * (l - 1);
}

export function levelForXp(xp: number): number {
  // Largest L with 50·L·(L−1) ≤ xp.
  const l = Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 50)) / 2);
  let level = Math.min(MAX_LEVEL, Math.max(1, l));
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= xp) level++;
  while (level > 1 && xpForLevel(level) > xp) level--;
  return level;
}

/** Coins for reaching a level. */
export function levelUpCoins(level: number): number {
  return 10 * level;
}

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP at the start of this level and at the next one (null at the cap). */
  levelXp: number;
  nextLevelXp: number | null;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  return { level, xp, levelXp: xpForLevel(level), nextLevelXp: level >= MAX_LEVEL ? null : xpForLevel(level + 1) };
}

/** Someone's progression at a glance (profiles, Home). */
export interface ProgressView extends LevelProgress {
  coins: number;
  streaks: Streaks;
}

// ── Earning XP and coins ───────────────────────────────────────────────────

export const EARN = {
  /** Every finished battle you played in. */
  battlePlayed: { xp: 20, coins: 2 },
  /** On top, for winning it. */
  battleWon: { xp: 30, coins: 10 },
  /** Per round you won. */
  roundWon: { xp: 5, coins: 0 },
  /** Per round you vote in, up to votesPerDay a day. */
  vote: { xp: 2, coins: 0 },
  votesPerDay: 10,
  /** Per post, up to postsPerDay a day. */
  post: { xp: 5, coins: 0 },
  postsPerDay: 5,
} as const;

/** XP and coins for one finished battle. */
export function battleReward(o: { won: boolean; roundsWon: number }): Reward {
  return {
    xp: EARN.battlePlayed.xp + (o.won ? EARN.battleWon.xp : 0) + EARN.roundWon.xp * Math.max(0, o.roundsWon),
    coins: EARN.battlePlayed.coins + (o.won ? EARN.battleWon.coins : 0),
  };
}

export type LedgerReason = "DAILY" | "ACHIEVEMENT" | "LEVEL_UP" | "BATTLE" | "VOTE" | "POST" | "PURCHASE" | "TRIVIA" | "DJ_LESSON" | "DJ_BATTLE" | "PARTY" | "WAR_VOTE" | "ONBOARDING" | "DROP_FIRE";

export interface WalletEntry {
  id: string;
  reason: LedgerReason;
  label: string;
  xp: number;
  coins: number;
  createdAt: string;
  /** In-app path for the thing it was for, if any. */
  link: string | null;
}

export interface WalletResponse extends LevelProgress {
  coins: number;
  history: WalletEntry[];
  nextCursor: string | null;
}

// ── Shop ───────────────────────────────────────────────────────────────────

export type ShopItemKind = "STREAK_FREEZE" | "FRAME";

export interface ShopItemDef {
  key: string;
  kind: ShopItemKind;
  title: string;
  description: string;
  icon: string;
  price: number;
  /** Frames: the ring color. */
  color?: string;
  /** Frames: the level needed to buy it. */
  minLevel?: number;
}

/** How many streak freezes you can hold at once. */
export const MAX_STREAK_FREEZES = 2;

export const SHOP: readonly ShopItemDef[] = [
  { key: "streak_freeze", kind: "STREAK_FREEZE", title: "Streak freeze", description: "Covers a day you miss, so your daily streak survives. Used automatically.", icon: "🧊", price: 100 },
  { key: "frame_gold", kind: "FRAME", title: "Gold frame", description: "A gold ring around your avatar everywhere.", icon: "🟡", price: 250, color: "#FBBF24" },
  { key: "frame_neon", kind: "FRAME", title: "Neon frame", description: "An electric cyan ring.", icon: "🔵", price: 250, color: "#22D3EE" },
  { key: "frame_rose", kind: "FRAME", title: "Rose frame", description: "A hot pink ring.", icon: "🩷", price: 250, color: "#F472B6" },
  { key: "frame_emerald", kind: "FRAME", title: "Emerald frame", description: "A bright green ring.", icon: "🟢", price: 400, color: "#34D399", minLevel: 5 },
  { key: "frame_legend", kind: "FRAME", title: "Legend frame", description: "A white-hot ring for level 10 and up.", icon: "⚪", price: 750, color: "#F5F3FF", minLevel: 10 },
];

export function shopItem(key: string | null | undefined): ShopItemDef | undefined {
  return key ? SHOP.find((i) => i.key === key) : undefined;
}

/** The ring color for a frame key, if it's a real frame. */
export function frameColor(key: string | null | undefined): string | undefined {
  const i = shopItem(key);
  return i?.kind === "FRAME" ? i.color : undefined;
}

export interface ShopItemView extends ShopItemDef {
  owned: boolean;
  equipped: boolean;
  /** Why you can't buy it right now, if you can't. */
  blockedReason: "NOT_ENOUGH_COINS" | "OWNED" | "MAX_HELD" | "LEVEL_TOO_LOW" | null;
}

export interface ShopResponse {
  coins: number;
  level: number;
  streakFreezes: number;
  maxStreakFreezes: number;
  frame: string | null;
  items: ShopItemView[];
}

// ── Onboarding ─────────────────────────────────────────────────────────────

/** A one-time welcome bonus for finishing the first-run path. */
export const ONBOARDING_BONUS: Reward = { xp: 50, coins: 25 };

export interface OnboardingState {
  /** Show the welcome flow / "Start here" card. */
  active: boolean;
  genres: string[];
  steps: { battle: boolean; trivia: boolean };
  /** What to do next, or null when done. */
  next: "genres" | "battle" | "trivia" | null;
  done: boolean;
  /** Paid when this request finished onboarding. */
  bonus: Reward | null;
  /** Whether the VYBZ bot can play right away (otherwise the first battle waits for a person). */
  botAvailable: boolean;
}
