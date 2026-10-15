import type { TrackCandidate } from "./types";

/**
 * Cross-provider matching: given a canonical track (usually from Apple Music,
 * which carries ISRC), find the YouTube video most likely to be the same
 * recording. Pure and deterministic so it can be unit-tested and tuned.
 */

const UNWANTED_VARIANTS = [
  "live",
  "cover",
  "karaoke",
  "instrumental",
  "remix",
  "sped up",
  "slowed",
  "reaction",
  "8d",
  "nightcore",
  "tutorial",
];

const DURATION_TOLERANCE_MS = 5_000;
export const MIN_MATCH_SCORE = 0.6;

export interface MatchResult {
  candidate: TrackCandidate;
  score: number;
}

export function youtubeSearchQuery(track: Pick<TrackCandidate, "artistName" | "title">): string {
  return `${track.artistName} ${stripFeat(track.title)}`;
}

export function scoreMatch(target: TrackCandidate, candidate: TrackCandidate): number {
  const targetTitle = normalize(stripFeat(target.title));
  const candTitle = normalize(candidate.title);
  const targetArtist = normalize(primaryArtist(target.artistName));
  const candArtist = normalize(candidate.artistName);

  let score = 0;

  // Title: the target's title must appear in the video title.
  if (candTitle.includes(targetTitle)) score += 0.4;
  else if (tokenOverlap(targetTitle, candTitle) >= 0.6) score += 0.2;

  // Artist: channel name or video title mentions the primary artist.
  if (candArtist === targetArtist) score += 0.3;
  else if (candArtist.includes(targetArtist) || candTitle.includes(targetArtist)) score += 0.2;

  // Duration: strongest signal that it's the same recording, not a music video edit.
  if (target.durationMs && candidate.durationMs) {
    const diff = Math.abs(target.durationMs - candidate.durationMs);
    if (diff <= DURATION_TOLERANCE_MS) score += 0.3;
    else if (diff <= 30_000) score += 0.1;
    else score -= 0.2;
  }

  // Variants the target is not (a live take when the target isn't live, etc.).
  for (const word of UNWANTED_VARIANTS) {
    const re = new RegExp(`\\b${word}\\b`);
    if (re.test(candTitle) && !re.test(targetTitle)) score -= 0.3;
  }

  if (candidate.embeddable === false) score -= 1;

  return Math.max(0, Math.min(1, score));
}

export function bestMatch(target: TrackCandidate, candidates: TrackCandidate[]): MatchResult | null {
  let best: MatchResult | null = null;
  for (const candidate of candidates) {
    const score = scoreMatch(target, candidate);
    if (!best || score > best.score) best = { candidate, score };
  }
  return best && best.score >= MIN_MATCH_SCORE ? best : null;
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripFeat(title: string): string {
  return title.replace(/\s*[([](feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, "").trim();
}

function primaryArtist(artist: string): string {
  return artist.split(/\s*(?:,|&| feat\.? | ft\.? | x )\s*/i)[0] ?? artist;
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  if (ta.size === 0) return 0;
  const tb = new Set(b.split(" "));
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / ta.size;
}
