import { describe, expect, it } from "vitest";
import { YouTubeAdapter, cleanChannelName, parseIsoDuration } from "../src";
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
    const { fetch } = stubFetch({ "/search": { error: "quota" } }, 403);
    const adapter = new YouTubeAdapter({ apiKey: "secret-key", fetch });
    await expect(adapter.search("x", { storefront: "us" })).rejects.toThrow(/YOUTUBE.*\/search failed$/);
    await expect(adapter.search("x", { storefront: "us" })).rejects.not.toThrow(/secret-key/);
  });
});
