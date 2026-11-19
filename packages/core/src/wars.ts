import type { UserSummary } from "./api";

/**
 * Vybz Album and Single Wars: two releases head to head, voted category by
 * category, plus track-by-track battles for albums.
 */

export type WarKind = "ALBUM" | "SINGLE";
export type WarStatus = "OPEN" | "CLOSED";
export type WarCategory = "overall" | "songs" | "production" | "lyrics" | "replay";

export const WAR_CATEGORIES: Record<WarKind, { key: WarCategory; label: string; hint: string }[]> = {
  ALBUM: [
    { key: "overall", label: "Overall album", hint: "Which is the better album, start to finish?" },
    { key: "songs", label: "Best individual songs", hint: "Which has the stronger standout tracks?" },
    { key: "production", label: "Production & beats", hint: "Sound, beats and arrangements." },
    { key: "lyrics", label: "Lyrics & storytelling", hint: "Writing, themes and storytelling." },
    { key: "replay", label: "Replay value", hint: "Which would you play again and again?" },
  ],
  SINGLE: [
    { key: "overall", label: "Better song", hint: "Which single wins?" },
    { key: "production", label: "Production & beat", hint: "Sound and beat." },
    { key: "lyrics", label: "Lyrics", hint: "Writing and delivery." },
    { key: "replay", label: "Replay value", hint: "Which would you play again?" },
  ],
};

export const WARS = {
  durationDays: 7,
  maxTrackBattles: 20,
  /** XP for voting in a war, for this many wars a day. */
  voteXp: 3,
  voteXpPerDay: 5,
  winXp: 0,
} as const;

/** "t3" is the third track-by-track battle. */
export const trackCategory = (i: number) => `t${i + 1}`;
export const isTrackCategory = (c: string) => /^t([1-9]|1\d|20)$/.test(c);

export interface WarTrack {
  title: string;
  catalogId: string | null;
  durationMs: number | null;
  previewUrl: string | null;
}

export interface WarSide {
  /** "APPLE_MUSIC:<album or song id>". */
  ref: string;
  title: string;
  artistName: string;
  releaseYear: number | null;
  artworkUrl: string | null;
  externalUrl: string | null;
  /** Albums only, in track order. */
  tracks: WarTrack[];
}

export interface WarTally {
  category: string;
  a: number;
  b: number;
  mine: "A" | "B" | null;
}

export interface WarView {
  id: string;
  kind: WarKind;
  status: WarStatus;
  title: string;
  a: WarSide;
  b: WarSide;
  creator: UserSummary;
  closesAt: string;
  voters: number;
  /** Category tallies. Counts are hidden (null) for categories you haven't voted in until the war closes. */
  categories: { key: WarCategory; label: string; hint: string; a: number | null; b: number | null; mine: "A" | "B" | null }[];
  tracks: { index: number; a: WarTrack; b: WarTrack; votes: { a: number; b: number } | null; mine: "A" | "B" | null }[];
  winner: "A" | "B" | "DRAW" | null;
  /** Artist challenge (side A called out side B). */
  challenge?: { from: string; to: string; fromHandle: string | null } | null;
  createdAt: string;
}

export interface WarListItem {
  id: string;
  kind: WarKind;
  status: WarStatus;
  title: string;
  a: Pick<WarSide, "title" | "artistName" | "artworkUrl" | "releaseYear">;
  b: Pick<WarSide, "title" | "artistName" | "artworkUrl" | "releaseYear">;
  voters: number;
  closesAt: string;
  winner: "A" | "B" | "DRAW" | null;
  voted: boolean;
  /** Artist challenge (side A called out side B). */
  challenge?: { from: string; to: string; fromHandle: string | null } | null;
}

export type WarPeriod = "week" | "month" | "year";

export interface WarRankingRow {
  rank: number;
  ref: string;
  title: string;
  artistName: string;
  artworkUrl: string | null;
  releaseYear: number | null;
  /** "Overall" votes won in the period. */
  votes: number;
  wars: number;
  wins: number;
  share: number;
}

export interface WarRankingsResponse {
  kind: WarKind;
  period: WarPeriod;
  rows: WarRankingRow[];
}

export interface AlbumHit {
  ref: string;
  title: string;
  artistName: string;
  releaseYear: number | null;
  artworkUrl: string | null;
  trackCount: number | null;
  isSingle: boolean;
}
