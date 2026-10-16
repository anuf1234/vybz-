import { MIN_LISTEN_MS } from "./rules";
import type { Side } from "./engine";

/** Clips (previews) shorter than the minimum only need to be heard to the end, minus a little slack. */
export function requiredListenMs(clipMs: number | null | undefined): number {
  if (!clipMs || clipMs <= 0) return MIN_LISTEN_MS;
  return Math.min(MIN_LISTEN_MS, Math.max(clipMs - 1_000, 0));
}

/**
 * Credits reported listening time, but never more than the wall-clock time
 * since this listener first started that submission (plus a little slack for
 * network jitter). A client can't claim 30 seconds of listening 2 seconds in.
 */
export function creditListen(opts: {
  previousMs: number;
  reportedMs: number;
  startedAt: Date;
  now: Date;
}): number {
  const elapsed = opts.now.getTime() - opts.startedAt.getTime() + 2_000;
  const plausible = Math.max(0, Math.min(opts.reportedMs, elapsed));
  return Math.max(opts.previousMs, Math.floor(plausible));
}

/**
 * Which side a voter sees on the left. Stable per voter and round, but varies
 * across voters so neither pick benefits from always being shown first.
 */
export function leftSideFor(voterKey: string, roundKey: string): Side {
  let h = 2166136261;
  for (const ch of `${voterKey}:${roundKey}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2 === 0 ? 0 : 1;
}
