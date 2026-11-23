import { describe, expect, it } from "vitest";
import { YouTubeAdapter, cleanChannelName, parseIsoDuration, playlistIdFromUrl } from "../src";
import type { ViewerContext } from "../src";
import { stubFetch, youtubeVideo } from "./fixtures";

const guest: ViewerContext = { userId: null, storefront: "us", connections: [] };

describe("parseIsoDuration", () => {
  it.each([
    ["PT3M36S", 216_000],
    ["PT1H2M", 3_720_000],
    ["PT45S", 45_000],
    ["P0D", 0],
    ["P1DT1S", 86_401_000],
  ])("%s → %d ms", (iso, ms) => expect(parseIsoDuration(iso)).toBe(ms));

  it("returns undefined for garbage", () => expect(parseIsoDuration("3:36")).toBeUndefined());
});

describe("cleanChannelName", () => {
  it("strips Topic and VEVO suffixes", () => {
    expect(cleanChannelName("Aaliyah - Topic")).toBe("Aaliyah");
    expect(cleanChannelName("TLCVEVO")).toBe("TLC");
  });
});

describe("YouTubeAdapter", () => {
  it("reads live view counts, skipping hidden ones", async () => {
    const { fetch, calls } = stubFetch({
      "/videos": { items: [{ id: "a", statistics: { viewCount: "1240000000" } }, { id: "b", statistics: {} }, { id: "c" }] },
    });
    const yt = new YouTubeAdapter({ apiKey: "k", fetch });
    const views = await yt.viewCounts(["a", "b", "c"]);
    expect([...views]).toEqual([["a", 1_240_000_000]]);
    expect(calls[0]!.url.searchParams.get("part")).toBe("statistics");
    expect(await yt.viewCounts([])).toEqual(new Map());
  });

  it("searches music videos, then hydrates via videos.list in search order", async () => {
    const { fetch, calls } = stubFetch({
      "/search": { items: [{ id: { videoId: "b" } }, { id: { videoId: "a" } }, { id: {} }] },
      "/videos": { items: [youtubeVideo({ id: "a" }), youtubeVideo({ id: "b", title: "Other" })] },
    });
    const adapter = new YouTubeAdapter({ apiKey: "k", fetch });

    const results = await adapter.search("tlc no scrubs", { storefront: "us" });

    const search = calls[0]!.url.searchParams;
    expect(search.get("videoCategoryId")).toBe("10");
    expect(search.get("videoEmbeddable")).toBe("true");
    expect(search.get("regionCode")).toBe("US");
    expect(search.get("key")).toBe("k");
    expect(calls[1]!.url.searchParams.get("id")).toBe("b,a");
    expect(results.map((r) => r.externalId)).toEqual(["b", "a"]);
    expect(results[1]).toMatchObject({ artistName: "TLC", durationMs: 216_000, embeddable: true });
  });

  it("offers an embed with a visible player, or only a link when embedding is disabled", () => {
    const adapter = new YouTubeAdapter({ apiKey: "k" });
    const [embed] = adapter.sources({ provider: "YOUTUBE", externalId: "abc" }, guest);
    expect(embed).toMatchObject({ tier: "EMBED", embed: { videoId: "abc" }, restrictions: { mustShowPlayer: true } });

    const blocked = adapter.sources({ provider: "YOUTUBE", externalId: "abc", embeddable: false }, guest);
    expect(blocked.map((s) => s.tier)).toEqual(["LINK_OUT"]);
  });

  it("surfaces API errors without leaking the key", async () => {
    const { fetch } = stubFetch({ "/search": { error: "quotaExceeded for key secret-key" } }, 403);
    const adapter = new YouTubeAdapter({ apiKey: "secret-key", fetch });
    await expect(adapter.search("x", { storefront: "us" })).rejects.toThrow(/YOUTUBE.*\/search failed with 403: .*quotaExceeded for key \[key\]/);
    await expect(adapter.search("x", { storefront: "us" })).rejects.not.toThrow(/secret-key/);
  });
});

describe("YouTube playlists", () => {
  it("reads a playlist link", () => {
    expect(playlistIdFromUrl("https://www.youtube.com/playlist?list=PLabcdefghij123")).toBe("PLabcdefghij123");
    expect(playlistIdFromUrl("https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijk&si=x")).toBe("OLAK5uy_abcdefghijk");
    expect(playlistIdFromUrl("https://youtu.be/abc?list=PLabcdefghij123")).toBe("PLabcdefghij123");
    expect(playlistIdFromUrl("PLabcdefghij123")).toBe("PLabcdefghij123");
    expect(playlistIdFromUrl("https://example.com/?list=PLabcdefghij123")).toBeNull();
    expect(playlistIdFromUrl("https://www.youtube.com/watch?v=abc")).toBeNull();
  });

  it("pages through items, dropping duplicates and deleted videos", async () => {
    const { fetch, calls } = stubFetch({
      "/playlists": { items: [{ snippet: { title: "Slow jams" } }] },
      "/playlistItems": (url: URL) =>
        url.searchParams.get("pageToken")
          ? { items: [{ contentDetails: { videoId: "c" } }, { contentDetails: { videoId: "a" } }] }
          : { items: [{ contentDetails: { videoId: "a" } }, { contentDetails: {} }, { contentDetails: { videoId: "b" } }], nextPageToken: "p2" },
    });
    const adapter = new YouTubeAdapter({ apiKey: "k", fetch });
    expect(await adapter.playlist("PLx")).toEqual({ title: "Slow jams", videoIds: ["a", "b", "c"] });
    expect(calls.filter((c) => c.url.pathname.endsWith("/playlistItems"))).toHaveLength(2);
  });

  it("returns null for a playlist that doesn't exist", async () => {
    const { fetch } = stubFetch({ "/playlists": { items: [] } });
    expect(await new YouTubeAdapter({ apiKey: "k", fetch }).playlist("PLnope")).toBeNull();
  });
});
