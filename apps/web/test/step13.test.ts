import { type DbHandle, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { forgetBot } from "../src/server/bot";
import { resetServerEnv } from "../src/server/env";
import { listDrops, runDailyDrops } from "../src/server/drops";
import { outboundLink } from "../src/server/outbound";
import { forgetSpotifyToken, spotifyLink, spotifyQuery } from "../src/server/spotify";
import { TEST_DB_URL, freshDb } from "./helpers";

describe("spotify queries", () => {
  it("uses ISRC for songs and title + artist for releases", () => {
    expect(spotifyQuery({ title: "x", artistName: "y", type: "track", isrc: "US123" })).toBe("isrc:US123");
    expect(spotifyQuery({ title: 'Big "Album" (Deluxe Edition)', artistName: "Act", type: "album", isrc: null })).toBe('album:"Big Album" artist:"Act"');
  });
});

describe.skipIf(!TEST_DB_URL)("outbound plays", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let fan: UserRow;

  beforeAll(async () => {
    h = await freshDb();
    forgetBot();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    [fan] = (await h.db.insert(schema.user).values({ id: "u_fan", name: "Fan", email: "f@x.com", handle: "fan" }).returning()) as [UserRow];
    await runDailyDrops(deps, { force: true });
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    resetServerEnv();
    return h?.close();
  });

  it("gives a link from our own records and logs the tap", async () => {
    const { items } = await listDrops(deps, fan, new URLSearchParams());
    const d = items[0]!;
    const sp = await outboundLink(deps, fan, null, { service: "spotify", kind: "release", id: d.id });
    expect(sp.url).toBe(`https://open.spotify.com/search/${encodeURIComponent(`${d.title} ${d.artistName}`)}`);
    const yt = await outboundLink(deps, null, "guest_key_123", { service: "youtube", kind: "release", id: d.id });
    expect(yt.url).toContain("music.youtube.com/search");
    await expect(outboundLink(deps, fan, null, { service: "source", kind: "release", id: d.id })).rejects.toMatchObject({ code: "NO_LINK" });
    await expect(outboundLink(deps, fan, null, { service: "evil", kind: "release", id: d.id, url: "https://evil.example" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const clicks = await h.db.select().from(schema.outboundClick);
    expect(clicks.map((c) => [c.service, c.userId, c.viewerKey])).toEqual([
      ["spotify", fan.id, `u:${fan.id}`],
      ["youtube", null, "g:guest_key_123"],
    ]);
    const w = items.find((x) => x.warId)!;
    expect((await outboundLink(deps, fan, null, { service: "spotify", kind: "war", id: w.warId!, side: "A" })).url).toContain("open.spotify.com");
  });

  it("finds the exact Spotify page when configured, and caches it", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
    resetServerEnv();
    forgetSpotifyToken();
    const calls: string[] = [];
    const fake = (async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).includes("accounts.spotify.com")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      return new Response(JSON.stringify({ albums: { items: [{ name: "Other", artists: [{ name: "X" }], external_urls: { spotify: "https://open.spotify.com/album/wrong" } }, { name: "Harbor Nights", artists: [{ name: "Harbor Lights Club" }], external_urls: { spotify: "https://open.spotify.com/album/right" } }] } }));
    }) as typeof fetch;
    const q = { title: "Harbor Nights", artistName: "Harbor Lights Club", type: "album" as const, isrc: null };
    expect(await spotifyLink(h.db, q, fake)).toBe("https://open.spotify.com/album/right");
    expect(await spotifyLink(h.db, q, fake)).toBe("https://open.spotify.com/album/right");
    expect(calls.filter((c) => c.includes("/search"))).toHaveLength(1);
    const [row] = await h.db.select().from(schema.linkCache).where(eq(schema.linkCache.key, "spotify:album:harbornights|harborlightsclub"));
    expect(row?.url).toBe("https://open.spotify.com/album/right");
  });
});
