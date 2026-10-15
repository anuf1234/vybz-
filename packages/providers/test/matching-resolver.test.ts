import { describe, expect, it } from "vitest";
import {
  AppleMusicAdapter,
  YouTubeAdapter,
  bestCommonTier,
  bestMatch,
  resolvePlayback,
  scoreMatch,
  youtubeSearchQuery,
} from "../src";
import type { ProviderRegistry, TrackCandidate, ViewerContext } from "../src";

const target: TrackCandidate = {
  provider: "APPLE_MUSIC",
  externalId: "1",
  title: "Try Again (feat. Timbaland)",
  artistName: "Aaliyah",
  durationMs: 284_000,
};

const yt = (title: string, artistName: string, durationMs: number, extra: Partial<TrackCandidate> = {}): TrackCandidate => ({
  provider: "YOUTUBE",
  externalId: title,
  title,
  artistName,
  durationMs,
  ...extra,
});

describe("matching", () => {
  it("drops featured artists from the search query", () => {
    expect(youtubeSearchQuery(target)).toBe("Aaliyah Try Again");
  });

  it("prefers the topic-channel audio over a live version and a cover", () => {
    const official = yt("Try Again", "Aaliyah", 284_000);
    const live = yt("Aaliyah - Try Again (Live)", "Some Fan", 300_000);
    const cover = yt("Try Again - Aaliyah cover", "Cover Kid", 280_000);
    const match = bestMatch(target, [live, cover, official]);
    expect(match?.candidate).toBe(official);
    expect(scoreMatch(target, live)).toBeLessThan(scoreMatch(target, official));
  });

  it("returns null when nothing is confidently the same recording", () => {
    expect(bestMatch(target, [yt("Totally Different Song", "Someone", 120_000)])).toBeNull();
  });

  it("never matches a video that cannot be embedded", () => {
    expect(bestMatch(target, [yt("Try Again", "Aaliyah", 284_000, { embeddable: false })])).toBeNull();
  });
});

describe("playback resolution", () => {
  const providers: ProviderRegistry = {
    APPLE_MUSIC: new AppleMusicAdapter({ developerToken: async () => "t" }),
    YOUTUBE: new YouTubeAdapter({ apiKey: "k" }),
  };
  const guest: ViewerContext = { userId: null, storefront: "us", connections: [] };
  const subscriber: ViewerContext = {
    userId: "u",
    storefront: "us",
    connections: [{ provider: "APPLE_MUSIC", canPlayFullCatalog: true }],
  };
  const both = [
    { provider: "APPLE_MUSIC" as const, externalId: "1", previewUrl: "https://p", externalUrl: "https://m" },
    { provider: "YOUTUBE" as const, externalId: "v" },
  ];
  const appleOnly = [both[0]!];
  const youtubeOnly = [both[1]!];

  it("orders sources best tier first", () => {
    expect(resolvePlayback(both, guest, providers).map((s) => s.tier)).toEqual(["EMBED", "PREVIEW", "LINK_OUT", "LINK_OUT"]);
    expect(resolvePlayback(both, subscriber, providers)[0]?.tier).toBe("PROVIDER_FULL");
  });

  it("ignores refs for providers that aren't configured", () => {
    expect(resolvePlayback(both, guest, { YOUTUBE: providers.YOUTUBE })).toHaveLength(2);
  });

  it("plays both sides of a round at the same tier", () => {
    const a = resolvePlayback(both, subscriber, providers);
    expect(bestCommonTier(a, resolvePlayback(both, subscriber, providers))).toBe("PROVIDER_FULL");
    expect(bestCommonTier(a, resolvePlayback(youtubeOnly, subscriber, providers))).toBe("EMBED");
    expect(bestCommonTier(a, resolvePlayback(appleOnly, guest, providers))).toBe("PREVIEW");
  });

  it("locks voting when the only shared option is a link out", () => {
    const linkOnly = resolvePlayback([{ provider: "YOUTUBE", externalId: "x", embeddable: false }], guest, providers);
    const previewOnly = resolvePlayback(appleOnly, guest, providers);
    expect(bestCommonTier(linkOnly, previewOnly)).toBeNull();
  });
});
