import { z } from "zod";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type BattleType = "SONG_FOR_SONG" | "PLAYLIST" | "DJ_MIX" | "LIVE_DJ";
export type Visibility = "PUBLIC" | "PRIVATE";
export type ChallengeMode = "DIRECT" | "OPEN" | "MATCHMAKING";

/** How long a sent challenge waits for an opponent. */
export const CHALLENGE_TTL_MS = 3 * DAY;
/** How long the opponent has to lock their lineup after accepting. */
export const LINEUP_WINDOW_MS = 2 * DAY;
/** Each side must be heard this long (or to the end of a shorter clip) before a vote counts. */
export const MIN_LISTEN_MS = 10_000;
/** How far ahead a premiere can be scheduled. */
export const MAX_SCHEDULE_AHEAD_MS = 14 * DAY;

export const QUICK_ROUND_OPTIONS = [5, 10, 20] as const;
export const ROUND_OPTIONS = [3, 5, 7, 10, 15, 20] as const;
export const PLAYLIST_LENGTH_OPTIONS = [3, 5, 7, 10] as const;

export const VOTING_DURATIONS = [
  { ms: 1 * HOUR, label: "1 hour" },
  { ms: 6 * HOUR, label: "6 hours" },
  { ms: 1 * DAY, label: "24 hours" },
  { ms: 2 * DAY, label: "2 days" },
  { ms: 3 * DAY, label: "3 days" },
] as const;
export const DEFAULT_VOTING_MS = 1 * DAY;

export const REVEAL_INTERVALS = [
  { ms: 0, label: "All rounds at once" },
  { ms: 10 * MIN, label: "One round every 10 minutes" },
  { ms: 1 * HOUR, label: "One round every hour" },
] as const;

export const GENRES = [
  "R&B",
  "Hip-Hop",
  "Pop",
  "Afrobeats",
  "Dancehall",
  "Reggae",
  "Soul",
  "House",
  "Amapiano",
  "Latin",
  "Rock",
  "Gospel",
  "Electronic",
  "Country",
  "Other",
] as const;

export interface ThemePreset {
  id: string;
  label: string;
  genre?: (typeof GENRES)[number];
  eraFrom?: number;
  eraTo?: number;
}

/** Quick Battle themes. An era, where a preset has one, is checked against release years. */
export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: "90s-rnb", label: "90s R&B", genre: "R&B", eraFrom: 1990, eraTo: 1999 },
  { id: "2000s-rnb", label: "2000s R&B", genre: "R&B", eraFrom: 2000, eraTo: 2009 },
  { id: "rap-features", label: "Best Rap Features", genre: "Hip-Hop" },
  { id: "cookout", label: "Cookout Classics" },
  { id: "afrobeats", label: "Afrobeats", genre: "Afrobeats" },
  { id: "dancehall", label: "Dancehall", genre: "Dancehall" },
  { id: "workout", label: "Workout" },
  { id: "heartbreak", label: "Heartbreak" },
  { id: "date-night", label: "Date Night" },
  { id: "old-school", label: "Old School", eraTo: 1989 },
  { id: "new-school", label: "New School", eraFrom: 2015 },
  { id: "women-of-hip-hop", label: "Women of Hip-Hop", genre: "Hip-Hop" },
  { id: "one-hit-wonders", label: "One Hit Wonders" },
];

const thisYear = new Date().getUTCFullYear();

/** Plain text: control characters stripped, trimmed, length-checked. */
export const plainLine = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(min, min > 1 ? `${label} needs at least ${min} characters.` : `${label} can't be empty.`)
        .max(max, `${label} can be at most ${max} characters.`),
    );

const year = z.number().int().min(1900).max(thisYear);

/** Everything the creator chooses. Validated on the server; the form is only a convenience. */
export const BattleSetupSchema = z
  .object({
    type: z.enum(["SONG_FOR_SONG", "PLAYLIST", "DJ_MIX", "LIVE_DJ"]),
    mode: z.enum(["DIRECT", "OPEN", "MATCHMAKING"]),
    title: plainLine(3, 80, "The title"),
    theme: plainLine(2, 60, "The theme"),
    genre: z.enum(GENRES).nullable(),
    tagline: plainLine(1, 120, "The challenge line").nullable(),
    roundCount: z.number().int().min(1).max(20),
    playlistLength: z.number().int().min(3).max(10).nullable(),
    visibility: z.enum(["PUBLIC", "PRIVATE"]),
    votingDurationMs: z.literal(VOTING_DURATIONS.map((d) => d.ms)),
    revealIntervalMs: z.literal(REVEAL_INTERVALS.map((d) => d.ms)),
    hideTotals: z.boolean(),
    eraFrom: year.nullable(),
    eraTo: year.nullable(),
    scheduledFor: z.date().nullable(),
  })
  .superRefine((s, ctx) => {
    if (s.type === "LIVE_DJ") {
      ctx.addIssue({ code: "custom", path: ["type"], message: "Live DJ battles are coming soon." });
    }
    if (s.type === "SONG_FOR_SONG" && !(ROUND_OPTIONS as readonly number[]).includes(s.roundCount)) {
      ctx.addIssue({ code: "custom", path: ["roundCount"], message: "Pick 3, 5, 7, 10, 15 or 20 rounds." });
    }
    if (s.type !== "SONG_FOR_SONG" && s.roundCount !== 1) {
      ctx.addIssue({ code: "custom", path: ["roundCount"], message: "Playlist and mix battles are a single round." });
    }
    if (s.type === "PLAYLIST" && !(PLAYLIST_LENGTH_OPTIONS as readonly number[]).includes(s.playlistLength ?? 0)) {
      ctx.addIssue({ code: "custom", path: ["playlistLength"], message: "Pick 3, 5, 7 or 10 tracks per playlist." });
    }
    if (s.type !== "PLAYLIST" && s.playlistLength !== null) {
      ctx.addIssue({ code: "custom", path: ["playlistLength"], message: "Only playlist battles have a playlist length." });
    }
    if (s.eraFrom !== null && s.eraTo !== null && s.eraFrom > s.eraTo) {
      ctx.addIssue({ code: "custom", path: ["eraTo"], message: "The era must start before it ends." });
    }
    if (s.type === "SONG_FOR_SONG" && s.revealIntervalMs > 0 && s.roundCount < 2) {
      ctx.addIssue({ code: "custom", path: ["revealIntervalMs"], message: "Staggered reveals need more than one round." });
    }
    if (s.type !== "SONG_FOR_SONG" && s.revealIntervalMs !== 0) {
      ctx.addIssue({ code: "custom", path: ["revealIntervalMs"], message: "Only song battles reveal round by round." });
    }
  });

export type BattleSetup = z.infer<typeof BattleSetupSchema>;

/** Entries each side brings: one track per round, a playlist of tracks, or one mix. */
export function lineupSize(s: Pick<BattleSetup, "type" | "roundCount" | "playlistLength">): number {
  if (s.type === "SONG_FOR_SONG") return s.roundCount;
  if (s.type === "PLAYLIST") return s.playlistLength ?? 0;
  return 1;
}

/** Era check against provider metadata. Unknown years are allowed. */
export function fitsEra(s: { eraFrom: number | null; eraTo: number | null }, releaseYear: number | null | undefined): boolean {
  if (releaseYear == null) return true;
  if (s.eraFrom !== null && releaseYear < s.eraFrom) return false;
  if (s.eraTo !== null && releaseYear > s.eraTo) return false;
  return true;
}

export function eraLabel(s: { eraFrom: number | null; eraTo: number | null }): string | null {
  const { eraFrom: a, eraTo: b } = s;
  if (a === null && b === null) return null;
  if (a !== null && b !== null) return a === b ? `${a}` : `${a}–${b}`;
  return a !== null ? `${a} or later` : `${b} or earlier`;
}

export const BATTLE_TYPE_LABELS: Record<BattleType, string> = {
  SONG_FOR_SONG: "Song for song",
  PLAYLIST: "Playlist",
  DJ_MIX: "DJ mix",
  LIVE_DJ: "Live DJ",
};

export function votingDurationLabel(ms: number): string {
  return VOTING_DURATIONS.find((d) => d.ms === ms)?.label ?? `${Math.round(ms / HOUR)} hours`;
}
