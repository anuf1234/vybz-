import { MIN_LISTEN_MS } from "./rules";

/** Clips shorter than the minimum only need to be heard to the end, minus a little slack. */
export function requiredListenMs(clipMs: number | null | undefined): number {
  if (!clipMs || clipMs <= 0) return MIN_LISTEN_MS;
  return Math.min(MIN_LISTEN_MS, Math.max(clipMs - 1_000, 0));
}

const SLACK_MS = 2_000;

/**
 * Credits reported listening, bounded by real time twice over:
 *  - per pick: never more than the time since this listener started that pick;
 *  - per battle: all of this listener's credit in the battle can't exceed the
 *    time since they first pressed play in it, so playing many picks at once
 *    (the way a bot would) earns nothing extra.
 * Credit never goes down.
 */
export function creditListen(o: {
  previousMs: number;
  reportedMs: number;
  startedAt: Date;
  /** Credit already given on this listener's other picks in the battle. */
  otherCreditMs: number;
  /** When this listener first started any pick in the battle. */
  battleStartedAt: Date;
  now: Date;
}): number {
  const sinceStart = o.now.getTime() - o.startedAt.getTime() + SLACK_MS;
  const battleBudget = o.now.getTime() - o.battleStartedAt.getTime() + SLACK_MS - o.otherCreditMs;
  const plausible = Math.max(0, Math.min(o.reportedMs, sinceStart, battleBudget));
  return Math.max(o.previousMs, Math.floor(plausible));
}
