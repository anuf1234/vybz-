import {
  type PlaybackProvider,
  type PlaybackSource,
  type PlaybackTier,
  type ProviderKind,
  TIER_RANK,
  type TrackProviderRef,
  type ViewerContext,
} from "./types";

export type ProviderRegistry = Partial<Record<ProviderKind, PlaybackProvider>>;

/**
 * All the ways this viewer can hear a track, best first. Sources in the same
 * tier keep the order of `refs`.
 */
export function resolvePlayback(
  refs: TrackProviderRef[],
  viewer: ViewerContext,
  providers: ProviderRegistry,
): PlaybackSource[] {
  const sources = refs.flatMap((ref) => providers[ref.provider]?.sources(ref, viewer) ?? []);
  return sources
    .map((s, i) => ({ s, i }))
    .sort((a, b) => TIER_RANK[b.s.tier] - TIER_RANK[a.s.tier] || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * Playback parity for battles: both sides of a round are played to a voter at
 * the same tier, so nobody wins because their pick was heard in full while the
 * other was a 30-second clip. Returns null if the only common tier is LINK_OUT,
 * in which case voting stays locked for that viewer.
 */
export function bestCommonTier(a: PlaybackSource[], b: PlaybackSource[]): PlaybackTier | null {
  const tiersB = new Set(b.map((s) => s.tier));
  const common = [...new Set(a.map((s) => s.tier))]
    .filter((t) => tiersB.has(t) && t !== "LINK_OUT")
    .sort((x, y) => TIER_RANK[y] - TIER_RANK[x]);
  return common[0] ?? null;
}

export function sourceForTier(sources: PlaybackSource[], tier: PlaybackTier): PlaybackSource | null {
  return sources.find((s) => s.tier === tier) ?? null;
}
