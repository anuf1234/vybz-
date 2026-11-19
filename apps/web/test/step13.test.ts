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

describe("fan verdict rules", () => {
  it("smooths scores and finds ISO weeks", async () => {
    const { verdictScore, isoWeek, weekStart } = await import("@vybz/core");
    expect(verdictScore(0, 0)).toBe(50);
    expect(verdictScore(5, 5)).toBe(78);
    expect(verdictScore(0, 5)).toBe(22);
    expect(isoWeek(new Date("2026-11-18T12:00:00Z"))).toBe("2026-W47");
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(weekStart("2026-W47").toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });
});

describe.skipIf(!TEST_DB_URL)("this or that and the weekly chart", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  const fans: UserRow[] = [];

  beforeAll(async () => {
    h = await freshDb();
    forgetBot();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    for (let i = 0; i < 6; i++) fans.push(((await h.db.insert(schema.user).values({ id: `u_v${i}`, name: `V${i}`, email: `v${i}@x.com`, handle: `voter${i}` }).returning()) as [UserRow])[0]);
    await runDailyDrops(deps, { force: true });
  });
  afterAll(() => h?.close());

  it("pairs drops of the same kind, once per person, and ranks the chart", async () => {
    const { nextPair, judgePair, chart, publishWeeklyChart } = await import("../src/server/verdict");
    const { items } = await listDrops(deps, fans[0]!, new URLSearchParams());
    const album = items.find((x) => x.kind === "ALBUM")!;
    const single = items.find((x) => x.kind === "SINGLE")!;
    await expect(judgePair(deps, fans[0]!, { a: album.id, b: single.id, winner: album.id })).rejects.toMatchObject({ code: "INVALID_PAIR" });

    const first = await nextPair(deps, fans[0]!);
    expect(first).not.toBeNull();
    expect(first!.a.kind === "SINGLE").toBe(first!.b.kind === "SINGLE");

    // Every fan picks "After Hours Tapes" over every other album.
    const albums = items.filter((x) => x.kind === "ALBUM");
    const champ = albums.find((x) => x.title === "After Hours Tapes")!;
    for (const fan of fans) for (const other of albums.filter((x) => x.id !== champ.id)) await judgePair(deps, fan, { a: other.id, b: champ.id, winner: champ.id });
    // A repeat pick by the same person doesn't count twice.
    await judgePair(deps, fans[0]!, { a: albums.find((x) => x.id !== champ.id)!.id, b: champ.id, winner: champ.id });

    const c = await chart(deps, fans[0]!, null);
    expect(c.final).toBe(false);
    expect(c.rows[0]!.release.title).toBe("After Hours Tapes");
    expect(c.rows[0]!.games).toBe(fans.length * (albums.length - 1));
    expect(c.rows[0]!.lastRank).toBeNull();
    const v = (await listDrops(deps, fans[0]!, new URLSearchParams("kind=ALBUM"))).items.find((x) => x.id === champ.id)!;
    expect(v.verdict.score).toBeGreaterThan(80);
    const xp = await h.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.reason, "VERDICT"));
    expect(xp.length).toBe(fans.length * (albums.length - 1));

    // Next Monday: this week is frozen and posted once.
    const nextMonday = new Date(Date.now() + 7 * 86_400_000);
    const pub = await publishWeeklyChart(deps, nextMonday);
    expect(pub).toMatchObject({ week: c.week, posted: true });
    expect(await publishWeeklyChart(deps, nextMonday)).toBeNull();
    const frozen = await chart(deps, null, c.week, nextMonday);
    expect(frozen.final).toBe(true);
    expect(frozen.rows[0]!.release.title).toBe("After Hours Tapes");
  });
});

describe.skipIf(!TEST_DB_URL)("saving the chart to Spotify", () => {
  it("needs a linked account, then makes a private playlist from the chart", async () => {
    const h = await freshDb();
    forgetBot();
    vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
    resetServerEnv();
    try {
      const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
      const deps: BattleDeps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
      const fans: UserRow[] = [];
      for (let i = 0; i < 5; i++) fans.push(((await h.db.insert(schema.user).values({ id: `u_s${i}`, name: `S${i}`, email: `s${i}@x.com`, handle: `spot${i}` }).returning()) as [UserRow])[0]);
      await runDailyDrops(deps, { force: true });
      const { judgePair, exportChartToSpotify } = await import("../src/server/verdict");
      const albums = (await listDrops(deps, fans[0]!, new URLSearchParams("kind=ALBUM"))).items;
      for (const f of fans) for (const o of albums.slice(1)) await judgePair(deps, f, { a: albums[0]!.id, b: o.id, winner: albums[0]!.id });

      await expect(exportChartToSpotify(deps, fans[0]!, {})).rejects.toMatchObject({ code: "SPOTIFY_NOT_LINKED" });
      await h.db.insert(schema.account).values({ id: "acc1", accountId: "sp-user", providerId: "spotify", userId: fans[0]!.id, accessToken: "user-token", accessTokenExpiresAt: new Date(Date.now() + 3600_000) });
      const posted: { url: string; body: unknown }[] = [];
      const fake = (async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === "POST") posted.push({ url: u, body: JSON.parse(String(init.body)) });
        if (u.includes("/search")) {
          const q = new URL(u).searchParams.get("q") ?? "";
          const title = /album:"([^"]+)"/.exec(q)?.[1] ?? "";
          const artist = /artist:"([^"]+)"/.exec(q)?.[1] ?? "";
          return new Response(JSON.stringify({ albums: { items: [{ id: `al-${title}`, name: title, artists: [{ name: artist }] }] } }));
        }
        if (u.includes("/albums/")) return new Response(JSON.stringify({ items: [{ uri: `spotify:track:${u.split("/albums/")[1]!.split("/")[0]}` }] }));
        if (u.endsWith("/me")) return new Response(JSON.stringify({ id: "sp-user" }));
        if (u.includes("/users/sp-user/playlists")) return new Response(JSON.stringify({ id: "pl1", external_urls: { spotify: "https://open.spotify.com/playlist/pl1" } }));
        if (u.includes("/playlists/pl1/tracks")) return new Response(JSON.stringify({ snapshot_id: "x" }));
        return new Response("no", { status: 404 });
      }) as typeof fetch;
      const r = await exportChartToSpotify(deps, fans[0]!, {}, fake);
      expect(r).toEqual({ url: "https://open.spotify.com/playlist/pl1", added: albums.length });
      expect(posted[0]!.body).toMatchObject({ public: false });
      expect((posted[1]!.body as { uris: string[] }).uris[0]).toBe(`spotify:track:al-${albums[0]!.title}`);
    } finally {
      vi.unstubAllEnvs();
      resetServerEnv();
      await h.close();
    }
  });
});
