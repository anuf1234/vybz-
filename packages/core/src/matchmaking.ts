import { matchWindow } from "./ranked";

/**
 * Smart matchmaking for quick battles. Someone looking for a battle (the
 * seeker) is matched against battles already waiting, scored on how well the
 * vibe fits, how close the two players' skill is, whether they're in the same
 * part of the world, and how long the other player has waited. The longer a
 * battle waits, the wider it accepts: any era after a while, then any genre.
 * Nobody waits forever: after `botOfferMs` the app offers a clearly labeled
 * bot match, and (if they said yes up front) the bot takes it at `botAfterMs`.
 */

export const MATCHMAKING = {
  /** A waiting battle accepts any era after this long… */
  widenEraMs: 45_000,
  /** …and any genre after this long. */
  widenGenreMs: 90_000,
  /** The app offers the bot (and solo modes) from here. */
  botOfferMs: 60_000,
  /** The bot takes it if the player opted in. */
  botAfterMs: 120_000,
} as const;

export interface MatchPrefs {
  genre: string | null;
  decade: number | null;
  /** Skill: the player's rating (ranked rating, or the starting rating if they haven't played ranked). */
  rating: number;
  /** "America", "Europe", "Africa"… from the IANA time zone; null when unknown. */
  region: string | null;
}

export interface WaitingBattle extends MatchPrefs {
  id: string;
  waitingMs: number;
}

export interface MatchOption {
  id: string;
  score: number;
  /** The vibe the battle will be played with (the seeker's choice wins where the waiting player has widened). */
  genre: string | null;
  decade: number | null;
  /** True when the waiting battle's vibe changes to fit the seeker. */
  widened: boolean;
}

/** "America/New_York" → "America"; "UTC" and unknown zones → null. */
export function regionOf(timeZone: string | null | undefined): string | null {
  if (!timeZone || !timeZone.includes("/")) return null;
  const head = timeZone.split("/")[0]!;
  return ["America", "Europe", "Africa", "Asia", "Australia", "Pacific", "Atlantic", "Indian"].includes(head) ? head : null;
}

/** How a waiting battle's vibe fits the seeker, or null if it can't. */
function fit(want: string | number | null, have: string | number | null, widened: boolean): { value: string | number | null; points: number; changed: boolean } | null {
  if (want === have) return { value: have, points: want === null ? 20 : 30, changed: false };
  if (want === null) return { value: have, points: 15, changed: false };
  if (have === null) return { value: want, points: 15, changed: true };
  return widened ? { value: want, points: 0, changed: true } : null;
}

/**
 * Waiting battles the seeker can take, best first. Ranked battles also have
 * to be within the rating window, which widens with the wait.
 */
export function rankMatches(seeker: MatchPrefs, waiting: WaitingBattle[], opts: { ranked: boolean }): MatchOption[] {
  const out: MatchOption[] = [];
  for (const w of waiting) {
    const genre = fit(seeker.genre, w.genre, w.waitingMs >= MATCHMAKING.widenGenreMs);
    const decade = fit(seeker.decade, w.decade, w.waitingMs >= MATCHMAKING.widenEraMs);
    if (!genre || !decade) continue;
    const gap = Math.abs(seeker.rating - w.rating);
    if (opts.ranked && gap > matchWindow(w.waitingMs)) continue;
    const score =
      genre.points +
      decade.points -
      // Skill: closer is better (100 rating points ≈ 5 points of score).
      gap / 20 +
      // Same part of the world: similar hours, similar music.
      (seeker.region && seeker.region === w.region ? 15 : 0) +
      // Don't leave anyone hanging: older battles go first, up to 3 minutes.
      Math.min(w.waitingMs, 180_000) / 6_000;
    out.push({ id: w.id, score, genre: genre.value as string | null, decade: decade.value as number | null, widened: genre.changed || decade.changed });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Letters only (no I, L or O), so battle codes never look like party codes (digits). */
export const BATTLE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const BATTLE_CODE_LENGTH = 6;

/** "abc-def", "ABC DEF", "abcdef" → "ABCDEF"; null if it can't be a battle code. */
export function normalizeBattleCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s-]/g, "");
  if (s.length !== BATTLE_CODE_LENGTH) return null;
  for (const ch of s) if (!BATTLE_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** "ABCDEF" → "ABC-DEF". */
export const battleCodeLabel = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;
