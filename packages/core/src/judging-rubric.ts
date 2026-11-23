/**
 * What the AI judge weighs, in order. The judge's prompt and the app's "How
 * the AI judges" note both come from this list, so they never drift apart.
 */
export const AI_RUBRIC = [
  { key: "fit", label: "Theme fit", hint: "How well the song matches the battle's theme, genre and era. An off-theme classic loses to an on-theme great." },
  { key: "craft", label: "Song quality", hint: "Songwriting, performance and production, as the recording is known." },
  { key: "release", label: "Impact on release", hint: "What it did when it came out: chart run, radio, the cultural moment it created." },
  { key: "recognition", label: "Awards and recognition", hint: "Grammys and other awards or nominations, certifications, critics' lists." },
  { key: "legacy", label: "Legacy and replay value", hint: "Is it a classic? Still played, covered, remade or sampled? How it holds up today." },
  { key: "today", label: "Streaming today", hint: "How much it's played now. VYBZ looks up live YouTube views for each pick; the AI never guesses numbers." },
  { key: "crowd", label: "Crowd appeal", hint: "How well it would land with a crowd that loves this theme." },
] as const;

export type RubricKey = (typeof AI_RUBRIC)[number]["key"];
export const RUBRIC_KEYS = AI_RUBRIC.map((r) => r.key) as unknown as readonly [RubricKey, ...RubricKey[]];

/** New releases: songs this recent may be newer than what the AI knows, so it doesn't count that against them. */
export function isRecentRelease(releaseYear: number | null | undefined, now = new Date()): boolean {
  return !!releaseYear && releaseYear >= now.getUTCFullYear() - 1;
}

/** "1.2B", "48M", "930K". */
export function compactCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
