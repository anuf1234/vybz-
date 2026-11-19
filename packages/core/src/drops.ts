/**
 * Daily Drops: new singles, EPs, albums and mixtapes, posted once a day.
 * Releases come from the music provider (charts, editorial new-music
 * playlists, and the latest release of artists people follow); mixtapes are
 * links people submit and moderators approve. VYBZ never hosts the audio.
 */

export type ReleaseKind = "SINGLE" | "EP" | "ALBUM" | "MIXTAPE";
export type ReleaseSource = "CHART" | "PLAYLIST" | "ARTIST" | "SUBMISSION";
export type ReleaseStatus = "LIVE" | "PENDING" | "REJECTED";

export const RELEASE_KINDS: readonly { key: ReleaseKind; label: string; plural: string }[] = [
  { key: "SINGLE", label: "Single", plural: "Singles" },
  { key: "EP", label: "EP", plural: "EPs" },
  { key: "ALBUM", label: "Album", plural: "Albums" },
  { key: "MIXTAPE", label: "Mixtape", plural: "Mixtapes" },
];

export const DROPS = {
  /** A provider release counts as new if it came out within this many days. */
  freshDays: 14,
  /** Releases featured in the daily VYBZ post. */
  perPost: 8,
  /** Hour (UTC) after which the day's drops are gathered and posted. 13:00 UTC is 8–9 am US Eastern. */
  postHourUtc: 13,
  /** Most artists checked for a latest release per run. */
  maxArtistChecks: 150,
  /** Artists one person can follow. */
  maxFollows: 300,
  /** Mixtape submissions per person per day. */
  submissionsPerDay: 3,
  /** XP for firing up a drop, a few a day. */
  fireXp: 2,
  fireXpPerDay: 5,
} as const;

/** Where a mixtape link may point. VYBZ links out; it never hosts the audio. */
export const MIXTAPE_HOSTS: readonly { host: string; label: string }[] = [
  { host: "soundcloud.com", label: "SoundCloud" },
  { host: "audiomack.com", label: "Audiomack" },
  { host: "youtube.com", label: "YouTube" },
  { host: "youtu.be", label: "YouTube" },
  { host: "music.youtube.com", label: "YouTube Music" },
  { host: "bandcamp.com", label: "Bandcamp" },
  { host: "music.apple.com", label: "Apple Music" },
  { host: "open.spotify.com", label: "Spotify" },
  { host: "tidal.com", label: "TIDAL" },
  { host: "livemixtapes.com", label: "LiveMixtapes" },
  { host: "datpiff.com", label: "DatPiff" },
];

/** The label for a link's host, or null if VYBZ doesn't accept links there. */
export function mixtapeHost(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const hit = MIXTAPE_HOSTS.find((x) => h === x.host || h.endsWith(`.${x.host}`));
  return hit?.label ?? null;
}

/** Album, EP or single, from what the provider tells us. */
export function releaseKind(r: { title: string; isSingle?: boolean | undefined; trackCount?: number | undefined }): ReleaseKind {
  if (r.isSingle) return "SINGLE";
  if (/\(?\bEP\)?\s*$/i.test(r.title.trim())) return "EP";
  if (r.trackCount !== undefined && r.trackCount <= 3) return "SINGLE";
  if (r.trackCount !== undefined && r.trackCount <= 6) return "EP";
  return "ALBUM";
}

/** Whether a YYYY-MM-DD release date is within `days` of `today` (and not in the future). */
export function isFresh(releaseDate: string | null | undefined, today: string, days: number = DROPS.freshDays): boolean {
  if (!releaseDate || !/^\d{4}-\d{2}-\d{2}/.test(releaseDate)) return false;
  const d = Date.parse(`${releaseDate.slice(0, 10)}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  return d <= t && t - d <= days * 86_400_000;
}

// ── API views ──────────────────────────────────────────────────────────────

export interface ReleaseView {
  id: string;
  kind: ReleaseKind;
  title: string;
  artistName: string;
  artworkUrl: string | null;
  /** Where to listen (the provider, or the mixtape's host). */
  externalUrl: string | null;
  /** Name of the site the link goes to. */
  host: string | null;
  releaseDate: string | null;
  genres: string[];
  /** The VYBZ day (YYYY-MM-DD) it was posted as a drop. */
  dropDay: string;
  /** Catalog ref usable for wars (`PROVIDER:id`); null for mixtapes. */
  ref: string | null;
  /** You fired it up. (Counts aren't shown in the app; they're kept for partners.) */
  fired: boolean;
  /** Following this release's artist. */
  following: boolean;
  /** Open war featuring this release, if any. */
  warId: string | null;
  submittedBy: { handle: string; displayName: string } | null;
  status: ReleaseStatus;
  /** Fan Verdict from this-or-that matchups. */
  verdict: VerdictView;
}

export interface DropsResponse {
  day: string;
  items: ReleaseView[];
  nextCursor: string | null;
}

export interface FollowedArtist {
  provider: string;
  externalId: string;
  name: string;
  artworkUrl: string | null;
  createdAt: string;
}

export interface ArtistFollowHit {
  provider: string;
  externalId: string;
  name: string;
  artworkUrl: string | null;
  following: boolean;
}

/** The VYBZ streak: consecutive days with any battle pick, vote, war vote, trivia game or fired-up drop. */
export interface VybzStreak {
  current: number;
  best: number;
  /** Already counted today. */
  activeToday: boolean;
  /** Streak freezes held (shared with the daily-reward streak). */
  freezes: number;
}

/** Home's "Today on VYBZ" card. */
export interface TodayView {
  day: string;
  drops: { today: number; week: number; top: ReleaseView[] };
  trivia: { done: boolean };
  streak: VybzStreak;
}

// ── Fan Verdict and the weekly chart ───────────────────────────────────────

export const VERDICT = {
  /** Matchups before a release shows a verdict or makes the chart. */
  minGames: 5,
  /** Smoothing: the score starts at 50% and moves with evidence. */
  prior: 2,
  xp: 1,
  xpPerDay: 20,
  /** Drops from this many days back can be matched up. */
  poolDays: 14,
  chartSize: 25,
} as const;

/** Smoothed win share, 0–100 (starts at 50, moves with evidence). */
export function verdictScore(wins: number, games: number): number {
  return Math.round(((wins + VERDICT.prior) / (games + 2 * VERDICT.prior)) * 100);
}

/** ISO week like "2026-W47" for a date (UTC). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

/** Monday 00:00 UTC of an ISO week. */
export function weekStart(week: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new Error("bad week");
  const y = Number(m[1]);
  const w = Number(m[2]);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86_400_000);
  return new Date(monday.getTime() + (w - 1) * 7 * 86_400_000);
}

export interface VerdictView {
  /** Smoothed share of matchups won (0–100); null until minGames. */
  score: number | null;
  games: number;
}

export interface VerdictPair {
  a: ReleaseView;
  b: ReleaseView;
  /** Pairs judged today, for the progress line. */
  judgedToday: number;
}

export interface ChartRow {
  rank: number;
  /** Last week's rank, null if new. */
  lastRank: number | null;
  release: ReleaseView;
  score: number;
  wins: number;
  games: number;
}

export interface ChartResponse {
  week: string;
  /** "Nov 16 – 22". */
  label: string;
  /** Frozen (a past week) or still moving (this week). */
  final: boolean;
  rows: ChartRow[];
  prevWeek: string | null;
  nextWeek: string | null;
}

// ── Growth metrics (staff) ─────────────────────────────────────────────────

export interface MetricsResponse {
  asOf: string;
  users: number;
  newUsers7d: number;
  /** Active today / in the last 7 / 30 days (UTC). */
  dau: number;
  wau: number;
  mau: number;
  /** DAU as a share of MAU, %. */
  stickiness: number | null;
  daily: { day: string; dau: number; signups: number }[];
  /** Signup cohorts by week: % active exactly 1, 7 and 30 days after joining (null until the cohort is old enough). */
  retention: { week: string; size: number; d1: number | null; d7: number | null; d30: number | null }[];
  week: {
    battles: number;
    votes: number;
    warVotes: number;
    trivia: number;
    fires: number;
    verdicts: number;
    posts: number;
    drops: number;
    pendingMixtapes: number;
    /** Actions per weekly active person. */
    perActiveUser: number;
  };
  /** Taps out to streaming services. */
  outbound: { service: string; week: number; month: number; total: number }[];
}

// ── Artists ────────────────────────────────────────────────────────────────

export type ArtistProfileStatus = "PENDING" | "VERIFIED" | "REJECTED";
export const ARTIST_LINKS = ["instagram", "tiktok", "x", "youtube", "website"] as const;
export type ArtistLinkKey = (typeof ARTIST_LINKS)[number];

export interface ArtistProfileView {
  id: string;
  name: string;
  status: ArtistProfileStatus;
  bio: string | null;
  links: Partial<Record<ArtistLinkKey, string>>;
  owner: { handle: string; displayName: string };
  /** Only shown to the owner and staff while pending. */
  code: string | null;
  proofUrl: string | null;
}

export interface ArtistPage {
  name: string;
  profile: ArtistProfileView | null;
  followers: number;
  following: boolean;
  releases: ReleaseView[];
  /** Average Fan Verdict of their releases that have one. */
  verdict: number | null;
  wars: { won: number; lost: number; drawn: number; open: number; recent: { id: string; title: string; status: "OPEN" | "CLOSED"; result: "WON" | "LOST" | "DRAW" | null; challenge: boolean }[] };
}

/** Artist challenge on a war: side A called out side B. */
export interface WarChallenge {
  from: string;
  to: string;
  fromHandle: string | null;
}

// ── Song of the Day / Week, Album of the Week ──────────────────────────────

/**
 * How much each signal counts. Fires and This-or-That wins are fans
 * voting; listens are people tapping out to hear it; plays are real plays
 * read from a linked Apple Music account (opt-in). Listens and plays count
 * once per person per release per period, so nobody can spam them.
 */
export const HEAT = { fire: 3, win: 2, play: 2, listen: 1 } as const;

export type DropAwardKind = "SONG_DAY" | "SONG_WEEK" | "ALBUM_WEEK";

export const DROP_AWARDS: Record<DropAwardKind, { label: string; icon: string }> = {
  SONG_DAY: { label: "Song of the Day", icon: "🎵" },
  SONG_WEEK: { label: "Song of the Week", icon: "🔥" },
  ALBUM_WEEK: { label: "Album of the Week", icon: "💿" },
};

export interface HeatStats {
  score: number;
  fires: number;
  wins: number;
  listens: number;
  /** Verified plays from linked Apple Music accounts. Older awards don't have it. */
  plays?: number;
}

export function heatScore(s: Omit<HeatStats, "score">): number {
  return s.fires * HEAT.fire + s.wins * HEAT.win + (s.plays ?? 0) * HEAT.play + s.listens * HEAT.listen;
}

/** "Count my plays": linked Apple Music listening. */
export interface MusicLinkStatus {
  /** Server can read Apple Music listening (Apple Music is set up). */
  available: boolean;
  linked: boolean;
}

/** One release's totals for one day (partner data export, staff only). */
export interface ReleaseDayStatsRow {
  day: string;
  releaseId: string;
  title: string;
  artistName: string;
  kind: ReleaseKind;
  provider: string;
  externalId: string;
  fires: number;
  wins: number;
  matchups: number;
  plays: number;
  listens: number;
  listensBy: Record<string, number>;
  heat: number;
}

/** A chart position, as the app shows it: rank only, no counts (those are kept for partners). */
export interface HeatRow {
  rank: number;
  release: ReleaseView;
}

export interface DropAwardView {
  award: DropAwardKind;
  period: string;
  release: ReleaseView;
}

export interface TopDropsResponse {
  /** UTC day and ISO week being counted. */
  day: string;
  week: string;
  /** Leaders so far (live): songs today, songs this week, albums and EPs this week. */
  songsToday: HeatRow[];
  songsWeek: HeatRow[];
  albumsWeek: HeatRow[];
  /** Past winners, newest first. */
  history: DropAwardView[];
}
