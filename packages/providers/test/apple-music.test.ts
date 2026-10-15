import { generateKeyPair, exportPKCS8, decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import { AppleMusicAdapter, DeveloperTokenCache, appleArtworkUrl, signDeveloperToken } from "../src";
import type { ViewerContext } from "../src";
import { appleSong, stubFetch } from "./fixtures";

const guest: ViewerContext = { userId: null, storefront: "us", connections: [] };
const subscriber: ViewerContext = {
  userId: "u1",
  storefront: "us",
  connections: [{ provider: "APPLE_MUSIC", canPlayFullCatalog: true }],
};

describe("Apple Music developer token", () => {
  it("signs an ES256 token with kid, issuer, expiry and origin", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const pem = await exportPKCS8(privateKey);
    const now = new Date("2026-10-15T00:00:00Z");
    const { token, expiresAt } = await signDeveloperToken(
      { teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem },
      { ttlSeconds: 3600, origins: ["https://urexp.com"], now },
    );
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    const claims = decodeJwt(token);
    expect(claims).toMatchObject({ iss: "TEAM123456", origin: ["https://urexp.com"] });
    expect(claims.exp! - claims.iat!).toBe(3600);
    expect(expiresAt.toISOString()).toBe("2026-10-15T01:00:00.000Z");
  });

  it("accepts keys with escaped newlines, as stored in env vars", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const escaped = (await exportPKCS8(privateKey)).replace(/\n/g, "\\n");
    await expect(signDeveloperToken({ teamId: "T", keyId: "K", privateKey: escaped })).resolves.toBeDefined();
  });

  it("caches the token until close to expiry", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const cache = new DeveloperTokenCache(
      { teamId: "T", keyId: "K", privateKey: await exportPKCS8(privateKey) },
      { ttlSeconds: 3600 },
    );
    const t0 = new Date("2026-10-15T00:00:00Z");
    const a = await cache.get(t0);
    expect(await cache.get(new Date(t0.getTime() + 30 * 60_000))).toBe(a);
    expect(await cache.get(new Date(t0.getTime() + 55 * 60_000))).not.toBe(a);
  });
});

describe("AppleMusicAdapter", () => {
  it("searches the catalog and maps songs to candidates", async () => {
    const { fetch, calls } = stubFetch({ "/catalog/us/search": { results: { songs: { data: [appleSong] } } } });
    const adapter = new AppleMusicAdapter({ developerToken: async () => "dev-token", fetch });

    const [track] = await adapter.search("  no scrubs  ", { storefront: "US", limit: 99 });

    expect(calls[0]!.url.searchParams.get("term")).toBe("no scrubs");
    expect(calls[0]!.url.searchParams.get("limit")).toBe("25");
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer dev-token");
    expect(track).toMatchObject({
      provider: "APPLE_MUSIC",
      externalId: "1440833098",
      title: "No Scrubs",
      artistName: "TLC",
      isrc: "USLF29900128",
      releaseYear: 1999,
      genres: ["R&B/Soul"],
      explicit: false,
      previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
    });
  });

  it("does not call the API for an empty query", async () => {
    const { fetch, calls } = stubFetch({});
    const adapter = new AppleMusicAdapter({ developerToken: async () => "t", fetch });
    expect(await adapter.search("   ", { storefront: "us" })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("rejects malformed storefronts before building a URL", async () => {
    const adapter = new AppleMusicAdapter({ developerToken: async () => "t", fetch: stubFetch({}).fetch });
    await expect(adapter.search("x", { storefront: "../us" })).rejects.toThrow("Invalid storefront");
  });

  it("returns null for an unknown song and looks up by ISRC", async () => {
    const { fetch, calls } = stubFetch({ "/catalog/us/songs": { data: [appleSong] } });
    const adapter = new AppleMusicAdapter({ developerToken: async () => "t", fetch });
    expect(await adapter.getTrack("missing", { storefront: "us" })).toBeNull();
    const [byIsrc] = await adapter.lookupByIsrc("uslf29900128", { storefront: "us" });
    expect(calls.at(-1)!.url.searchParams.get("filter[isrc]")).toBe("USLF29900128");
    expect(byIsrc?.externalId).toBe("1440833098");
  });

  it("offers full playback only to subscribers, previews to everyone", () => {
    const adapter = new AppleMusicAdapter({ developerToken: async () => "t" });
    const ref = { provider: "APPLE_MUSIC" as const, externalId: "1", previewUrl: "https://p", externalUrl: "https://m" };

    expect(adapter.sources(ref, guest).map((s) => s.tier)).toEqual(["PREVIEW", "LINK_OUT"]);
    expect(adapter.sources(ref, subscriber).map((s) => s.tier)).toEqual(["PROVIDER_FULL", "PREVIEW", "LINK_OUT"]);
    const preview = adapter.sources(ref, guest)[0]!;
    expect(preview.restrictions.maxPlayMs).toBe(30_000);
  });

  it("builds artwork URLs from Apple's template", () => {
    expect(appleArtworkUrl("https://x/{w}x{h}bb.jpg", 300)).toBe("https://x/300x300bb.jpg");
  });
});
