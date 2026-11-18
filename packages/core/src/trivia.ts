import type { UserSummary } from "./api";

/**
 * Music trivia: the daily 10-question challenge and category practice.
 * Rules shared by the server and the apps.
 */

export type TriviaCategory = "GENRE" | "ARTIST" | "ALBUM_ART" | "HISTORY" | "GUESS_SONG";
export const TRIVIA_CATEGORIES: readonly TriviaCategory[] = ["GENRE", "ARTIST", "ALBUM_ART", "HISTORY", "GUESS_SONG"];

export const TRIVIA_CATEGORY_INFO: Record<TriviaCategory, { label: string; icon: string; blurb: string }> = {
  GENRE: { label: "Genre trivia", icon: "🎛️", blurb: "Sounds, scenes and tempos, one genre at a time." },
  ARTIST: { label: "Artist trivia", icon: "🎤", blurb: "Who's from where, who played what, who was in which group." },
  ALBUM_ART: { label: "Album art", icon: "🖼️", blurb: "Name the album from its cover." },
  HISTORY: { label: "Music history", icon: "📻", blurb: "Labels, formats, festivals and firsts." },
  GUESS_SONG: { label: "Guess the song", icon: "🎧", blurb: "Hear a short official preview, name the song." },
};

export type TriviaMode = "DAILY" | "PRACTICE";
export type TriviaQuestionStatus = "DRAFT" | "APPROVED" | "REJECTED" | "RETIRED";
export type TriviaQuestionSource = "SEED" | "CATALOG" | "AI" | "ADMIN";

export const TRIVIA = {
  /** Questions in a game. */
  questions: 10,
  /** Fewest approved questions a practice game needs. */
  minPracticeQuestions: 5,
  /** Time to answer each question. */
  answerMs: 20_000,
  /** Network allowance on top of answerMs. */
  graceMs: 2_000,
  /** Points for a correct answer, plus up to speedBonus for answering fast. */
  correctPoints: 100,
  speedBonus: 50,
  /** Daily challenge: XP for finishing, per correct answer, and coins for a perfect game. */
  dailyXp: 20,
  dailyXpPerCorrect: 3,
  perfectCoins: 10,
  /** Practice: XP per correct answer, for this many games a day. */
  practiceXpPerCorrect: 2,
  practiceRewardedPerDay: 3,
} as const;

/** Points for one answer. `elapsedMs` is from when the question was shown. */
export function triviaPoints(correct: boolean, elapsedMs: number): number {
  if (!correct) return 0;
  const left = Math.max(0, Math.min(1, 1 - elapsedMs / TRIVIA.answerMs));
  return TRIVIA.correctPoints + Math.round(TRIVIA.speedBonus * left);
}

export function triviaMaxScore(questions: number = TRIVIA.questions): number {
  return questions * (TRIVIA.correctPoints + TRIVIA.speedBonus);
}

export interface TriviaReward {
  xp: number;
  coins: number;
}

export function triviaReward(mode: TriviaMode, correct: number, total: number, rewardedPractice = true): TriviaReward {
  if (mode === "DAILY") return { xp: TRIVIA.dailyXp + TRIVIA.dailyXpPerCorrect * correct, coins: correct === total && total > 0 ? TRIVIA.perfectCoins : 0 };
  return rewardedPractice ? { xp: TRIVIA.practiceXpPerCorrect * correct, coins: 0 } : { xp: 0, coins: 0 };
}

/**
 * Lyrics guard: questions may name songs but must not quote lyrics. Rejects
 * quoted passages longer than a title and any mention of lyrics.
 */
export function lyricsProblem(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    if (!t) continue;
    if (/\blyric/i.test(t)) return "Questions can't quote lyrics or ask people to finish them.";
    for (const m of t.matchAll(/["“”‘’'](.+?)["“”‘’']/g)) {
      const words = m[1]!.trim().split(/\s+/).filter(Boolean);
      if (words.length > 8) return "That quoted passage is too long. Quote titles only, never lyrics.";
    }
    if (/\b(finish|complete|fill in) (the|this) (line|verse|chorus|hook|bar)\b/i.test(t)) return "Questions can't ask people to finish a line of a song.";
  }
  return null;
}

// ── API views ──────────────────────────────────────────────────────────────

export interface TriviaQuestionView {
  id: string;
  /** 0-based position in the game. */
  index: number;
  total: number;
  category: TriviaCategory;
  genre: string | null;
  prompt: string;
  choices: string[];
  /** Album art (provider-hosted, never re-hosted). */
  imageUrl: string | null;
  /** Official provider preview for Guess the song. */
  audioUrl: string | null;
  /** When the clock started for this question (server time). */
  servedAt: string;
  timeLimitMs: number;
}

export interface TriviaAnswerResult {
  correct: boolean;
  /** The right choice and why. */
  answerIndex: number;
  explanation: string | null;
  points: number;
  timedOut: boolean;
  score: number;
  next: TriviaQuestionView | null;
  finished: boolean;
}

export interface TriviaReviewItem {
  questionId: string;
  category: TriviaCategory;
  prompt: string;
  choices: string[];
  imageUrl: string | null;
  answerIndex: number;
  yourChoice: number | null;
  correct: boolean;
  points: number;
  explanation: string | null;
  /** Share of players who got it right, 0–100, or null before anyone else has. */
  communityCorrectPct: number | null;
}

export interface TriviaCommunity {
  players: number;
  averageScore: number;
  /** Share of other players you beat, 0–100. */
  percentile: number;
  rank: number;
}

export interface TriviaResult {
  playId: string;
  mode: TriviaMode;
  day: string | null;
  category: TriviaCategory | null;
  genre: string | null;
  score: number;
  maxScore: number;
  correct: number;
  total: number;
  reward: TriviaReward;
  /** Daily only. */
  community: TriviaCommunity | null;
  streak: { current: number; best: number };
  review: TriviaReviewItem[];
  /** Badges unlocked by this game. */
  badges: { code: string; title: string; icon: string }[];
  /** Suggested battle for the "Can you win a battle?" button. */
  battleGenre: string | null;
}

export interface TriviaPlayView {
  id: string;
  mode: TriviaMode;
  status: "IN_PROGRESS" | "FINISHED";
  score: number;
  answered: number;
  total: number;
  question: TriviaQuestionView | null;
  result: TriviaResult | null;
}

export interface TriviaLeaderRow {
  rank: number;
  user: UserSummary;
  score: number;
  /** Games counted (1 for "today"). */
  games: number;
  isYou: boolean;
}

export type TriviaLeaderboardPeriod = "today" | "week" | "all";

export interface TriviaLeaderboardResponse {
  period: TriviaLeaderboardPeriod;
  scope: "global" | "following";
  day: string;
  rows: TriviaLeaderRow[];
  you: TriviaLeaderRow | null;
}

export interface TriviaHubResponse {
  day: string;
  daily: { status: "NOT_STARTED" | "IN_PROGRESS" | "FINISHED"; playId: string | null; score: number | null; players: number };
  streak: { current: number; best: number };
  categories: { category: TriviaCategory; label: string; icon: string; blurb: string; available: boolean; questions: number }[];
  practiceRewardsLeft: number;
  top: TriviaLeaderRow[];
}

// ── Admin ──────────────────────────────────────────────────────────────────

export interface TriviaAdminQuestion {
  id: string;
  category: TriviaCategory;
  genre: string | null;
  difficulty: number;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string | null;
  imageUrl: string | null;
  hasAudio: boolean;
  source: TriviaQuestionSource;
  status: TriviaQuestionStatus;
  timesAsked: number;
  correctPct: number | null;
  flags: number;
  flagReasons: string[];
  createdAt: string;
  reviewedBy: string | null;
}

export interface TriviaAdminList {
  items: TriviaAdminQuestion[];
  counts: Record<TriviaQuestionStatus | "FLAGGED", number>;
}

export interface TriviaQuestionInput {
  category: TriviaCategory;
  genre?: string | null;
  difficulty?: number;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation?: string | null;
}
