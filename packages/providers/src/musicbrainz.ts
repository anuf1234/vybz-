import { z } from "zod";
import { sameArtist, sameSongTitle } from "./matching";
import type { FetchLike } from "./types";

/**
 * Original release years from MusicBrainz, the open music encyclopedia. Used
 * when a pick comes from YouTube without an Apple Music match: a video's upload
 * date is not when the song came out.
 *
 * MusicBrainz asks for an identifying User-Agent and at most one request per
 * second; lookups are queued to respect that.
 */

const RecordingSearchSchema = z.object({
  recordings: z.array(
    z.object({
      score: z.number().optional(),
      title: z.string(),
      "first-release-date": z.string().optional(),
      "artist-credit": z.array(z.object({ name: z.string() })).optional(),
    }),
  ),
});

export interface ReleaseYearLookup {
  firstReleaseYear(artist: string, title: string): Promise<number | null>;
}

export interface MusicBrainzConfig {
  /** e.g. "VYBZ/0.1 (https://urexp.com)" */
  userAgent: string;
  fetch?: FetchLike;
  /** Minimum gap between requests. */
  intervalMs?: number;
  timeoutMs?: number;
}

const API = "https://musicbrainz.org/ws/2/recording";

export class MusicBrainzReleaseYears implements ReleaseYearLookup {
  private readonly fetchFn: FetchLike;
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(private readonly config: MusicBrainzConfig) {
    this.fetchFn = config.fetch ?? fetch;
  }

  /** The earliest first-release year among recordings matching the artist and title, or null. */
  async firstReleaseYear(artist: string, title: string): Promise<number | null> {
    if (!artist.trim() || !title.trim()) return null;
    const q = `recording:"${esc(title)}" AND artist:"${esc(artist)}"`;
    const url = `${API}?${new URLSearchParams({ query: q, fmt: "json", limit: "25" })}`;
    const json = await this.throttled(() => this.get(url));
    if (json === null) return null;
    const years = RecordingSearchSchema.parse(json)
      .recordings.filter((r) => (r.score ?? 100) >= 80)
      .filter((r) => sameSongTitle(r.title, title) && (r["artist-credit"] ?? []).some((c) => sameArtist(c.name, artist)))
      .map((r) => Number.parseInt((r["first-release-date"] ?? "").slice(0, 4), 10))
      .filter((y) => Number.isFinite(y) && y >= 1900);
    // The same song shows up as many recordings (album, single, compilations, remasters); the earliest is the original.
    return years.length ? Math.min(...years) : null;
  }

  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.last + (this.config.intervalMs ?? 1100) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async get(url: string): Promise<unknown> {
    const res = await this.fetchFn(url, {
      headers: { "User-Agent": this.config.userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 6000),
    });
    if (!res.ok) return null;
    return res.json();
  }
}

/** Lucene special characters inside a quoted phrase. */
function esc(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}
