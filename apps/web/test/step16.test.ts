import { heatScore, isoWeek } from "@vybz/core";
import { type DbHandle, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { forgetBot } from "../src/server/bot";
import { giveDropAwards, topDrops } from "../src/server/drop-awards";
import { fireRelease, followArtist, listDrops, runDailyDrops } from "../src/server/drops";
import { outboundLink } from "../src/server/outbound";
import { TEST_DB_URL, freshDb } from "./helpers";

describe("heat", () => {
  it("weights fires, wins and listens", () => {
    expect(heatScore({ fires: 2, wins: 3, listens: 4 })).toBe(2 * 3 + 3 * 2 + 4);
    expect(heatScore({ fires: 0, wins: 0, listens: 1, plays: 3 })).toBe(1 + 3 * 2);
  });
});

describe.skipIf(!TEST_DB_URL)("Song of the Day / Week and Album of the Week", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  const fans: UserRow[] = [];

  beforeAll(async () => {
    h = await freshDb();
    forgetBot();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    for (let i = 0; i < 4; i++) fans.push(((await h.db.insert(schema.user).values({ id: `u_h${i}`, name: `H${i}`, email: `h${i}@x.com`, handle: `heat${i}` }).returning()) as [UserRow])[0]);
    await runDailyDrops(deps, { force: true });
  });
  afterAll(() => h?.close());

  it("ranks live leaders from fires, This-or-That wins and unique listens", async () => {
    const { items } = await listDrops(deps, fans[0]!, new URLSearchParams());
    const singles = items.filter((x) => x.kind === "SINGLE");
    const albums = items.filter((x) => x.kind === "ALBUM");
    const [hot, warm] = [singles[0]!, singles[1]!];
    for (const f of fans) await fireRelease(deps, f, hot.id, { on: true });
    // The same person listening three times counts once; a guest counts too.
    for (let i = 0; i < 3; i++) await outboundLink(deps, fans[0]!, null, { service: "spotify", kind: "release", id: warm.id });
    await outboundLink(deps, null, "guest_abcdefgh", { service: "youtube", kind: "release", id: warm.id });
    await h.db.insert(schema.releaseDuel).values({ userId: fans[1]!.id, aId: albums[0]!.id < albums[1]!.id ? albums[0]!.id : albums[1]!.id, bId: albums[0]!.id < albums[1]!.id ? albums[1]!.id : albums[0]!.id, winnerId: albums[1]!.id });
    await fireRelease(deps, fans[2]!, albums[1]!.id, { on: true });

    const t = await topDrops(deps, fans[0]!);
    // The app gets positions only, never counts.
    expect(t.songsToday.map((r) => r.release.id)).toEqual([hot.id, warm.id]);
    expect(JSON.stringify(t)).not.toMatch(/"(heat|fires|wins|listens|plays|stats)"/);
    expect(t.songsWeek[0]!.release.id).toBe(hot.id);
    expect(t.albumsWeek[0]).toMatchObject({ rank: 1, release: { id: albums[1]!.id } });
    expect(t.history).toEqual([]);
    // The counts behind it.
    const { heat } = await import("../src/server/drop-awards");
    const day = new Date().toISOString().slice(0, 10);
    const w = { start: new Date(`${day}T00:00:00Z`), end: new Date(Date.now() + 86_400_000) };
    const songs = await heat(h.db, w, ["SINGLE"]);
    expect(songs.get(hot.id)).toEqual({ score: 12, fires: 4, wins: 0, listens: 0, plays: 0 });
    expect(songs.get(warm.id)).toEqual({ score: 2, fires: 0, wins: 0, listens: 2, plays: 0 });
    expect((await heat(h.db, w, ["ALBUM"])).get(albums[1]!.id)).toMatchObject({ score: 5, fires: 1, wins: 1 });
  });

  it("freezes the winners when the day and week end, posts them and tells the artist's fans", async () => {
    const { items } = await listDrops(deps, fans[0]!, new URLSearchParams());
    const hot = items.find((x) => x.kind === "SINGLE")!;
    await followArtist(deps, fans[3]!, { releaseId: hot.id });
    const tomorrow = new Date(Date.now() + 86_400_000);
    // On a Sunday (UTC) tomorrow is already next week, so the week's awards come due too.
    const newWeek = isoWeek(tomorrow) !== isoWeek(new Date());
    expect(await giveDropAwards(deps, tomorrow)).toBe(newWeek ? 3 : 1);
    expect(await giveDropAwards(deps, tomorrow)).toBe(0);
    const nextWeek = new Date(Date.now() + 7 * 86_400_000);
    expect(await giveDropAwards(deps, nextWeek)).toBe(newWeek ? 0 : 2);
    const awards = await h.db.select().from(schema.dropAward);
    expect(awards.map((a) => a.award).sort()).toEqual(["ALBUM_WEEK", "SONG_DAY", "SONG_WEEK"]);
    expect(awards.find((a) => a.award === "SONG_WEEK")!.period).toBe(isoWeek(new Date()));
    expect(awards.every((a) => a.postId)).toBe(true);
    const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.userId, fans[3]!.id));
    expect(notes.some((n) => n.type === "DROP_AWARD" && n.title.includes("Song of the Day"))).toBe(true);
    const t = await topDrops(deps, null);
    expect(t.history.map((x) => x.award)).toHaveLength(3);
    // Posts and notifications name the winner but give no counts.
    const posts = await h.db.select().from(schema.post);
    expect(posts.some((p) => p.body.includes("Song of the Day"))).toBe(true);
    expect(posts.every((p) => !/\d+ (fires|listens|plays)/.test(p.body))).toBe(true);

    // Staff can export the counts for partners; others can't.
    const { exportAwards, exportReleaseStats, snapshotDay } = await import("../src/server/partner-data");
    const mod = ((await h.db.insert(schema.user).values({ id: "u_hm", name: "M", email: "hm@x.com", handle: "heatmod", role: "MODERATOR" }).returning()) as [UserRow])[0];
    await expect(exportReleaseStats(deps, fans[0]!, new URLSearchParams())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const today = new Date().toISOString().slice(0, 10);
    expect(await snapshotDay(h.db, today)).toBeGreaterThan(0);
    const json = (await exportReleaseStats(deps, mod, new URLSearchParams())) as { rows: { releaseId: string; fires: number; heat: number; listensBy: Record<string, number> }[] };
    const hotRow = json.rows.find((r) => r.releaseId === hot.id)!;
    expect(hotRow).toMatchObject({ fires: 4, heat: 12 });
    const csv = (await exportReleaseStats(deps, mod, new URLSearchParams("format=csv"))) as string;
    expect(csv.split("\n")[0]).toBe("day,release_id,title,artist,type,catalog,catalog_id,heat,fires,this_or_that_wins,this_or_that_matchups,apple_music_plays,listens,listens_spotify,listens_apple_music,listens_youtube,listens_other");
    expect(csv).toContain(hot.id);
    const awardsCsv = (await exportAwards(deps, mod, new URLSearchParams("format=csv"))) as string;
    expect(awardsCsv.split("\n").filter(Boolean)).toHaveLength(4);
  });
});

describe("spotting new plays", () => {
  it("takes the songs above where last time's list starts", async () => {
    const { newPlays } = await import("../src/server/music-plays");
    expect(newPlays(["n2", "n1", "a", "b", "c", "d"], ["a", "b", "c", "d"])).toEqual(["n2", "n1"]);
    expect(newPlays(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
    expect(newPlays(["x", "y"], [])).toEqual(["x", "y"]);
    expect(newPlays(["x", "y", "z"], ["q", "r", "s"])).toEqual(["x", "y", "z"]);
  });
});

describe.skipIf(!TEST_DB_URL)("Count my plays (Apple Music)", () => {
  it("links with consent, counts new plays of drops once a day, and forgets the token", async () => {
    const h = await freshDb();
    const { vi } = await import("vitest");
    const { resetServerEnv } = await import("../src/server/env");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-123");
    resetServerEnv();
    try {
      const { ProviderError } = await import("@vybz/providers");
      const { linkAppleMusic, musicLinkStatus, syncPlays, unlinkAppleMusic, openToken } = await import("../src/server/music-plays");
      const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
      const deps: BattleDeps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
      const [u] = (await h.db.insert(schema.user).values({ id: "u_pl", name: "P", email: "p@x.com", handle: "player1" }).returning()) as [UserRow];
      const day = new Date().toISOString().slice(0, 10);
      await h.db.insert(schema.release).values([
        { id: "r_single", provider: "APPLE_MUSIC", externalId: "555", kind: "SINGLE", title: "Hit", artistName: "Star", source: "CHART", dropDay: day },
        { id: "r_album", provider: "APPLE_MUSIC", externalId: "777", kind: "ALBUM", title: "Record", artistName: "Star", source: "CHART", dropDay: day },
      ]);
      let history = [{ songId: "old1", albumId: "555", title: "Hit", artistName: "Star" }, { songId: "old2", albumId: "999", title: "x", artistName: "y" }];
      let fail: number | null = null;
      const reader = {
        recentlyPlayed: async (token: string) => {
          expect(token).toBe("music-user-token-abcdefghijklmnop");
          if (fail) throw new ProviderError("APPLE_MUSIC", fail, "nope");
          return history;
        },
      };
      const m = { appDeveloperToken: async () => "dev", reader };
      expect(await musicLinkStatus(deps, m, u)).toMatchObject({ available: true, linked: false });
      await linkAppleMusic(deps, m, u, { userToken: "music-user-token-abcdefghijklmnop" });
      const [link] = await h.db.select().from(schema.musicLink).where(eq(schema.musicLink.userId, u.id));
      expect(link!.tokenEnc).not.toContain("music-user-token");
      expect(openToken(link!.tokenEnc)).toBe("music-user-token-abcdefghijklmnop");

      // Songs already played before linking don't count.
      const later = (hours: number) => new Date(Date.now() + hours * 3600_000);
      expect(await syncPlays(deps, m, later(5))).toBe(0);
      // New plays: the single twice and a song from the album.
      history = [{ songId: "s1", albumId: "555", title: "Hit", artistName: "Star" }, { songId: "s2", albumId: "777", title: "Track 2", artistName: "Star" }, { songId: "s1", albumId: "555", title: "Hit", artistName: "Star" }, ...history];
      const n = await syncPlays(deps, m, later(10));
      expect(n).toBe(2);
      // Not due again until a few hours pass; the same day doesn't count twice.
      expect(await syncPlays(deps, m, later(11))).toBe(0);
      const t = await topDrops(deps, null, later(10));
      expect(t.songsToday.some((r) => r.release.id === "r_single")).toBe(true);
      const { heat } = await import("../src/server/drop-awards");
      const w = { start: new Date(Date.now() - 86_400_000), end: later(48) };
      expect((await heat(h.db, w, ["SINGLE"])).get("r_single")).toMatchObject({ plays: 1, score: 2 });
      expect((await heat(h.db, w, ["ALBUM"])).get("r_album")).toMatchObject({ plays: 1 });
      expect(await musicLinkStatus(deps, m, u)).toEqual({ available: true, linked: true });

      // A revoked token is forgotten.
      fail = 401;
      await syncPlays(deps, m, later(20));
      expect((await musicLinkStatus(deps, m, u)).linked).toBe(false);
      fail = null;
      await linkAppleMusic(deps, m, u, { userToken: "music-user-token-abcdefghijklmnop" });
      await unlinkAppleMusic(deps, m, u);
      expect(await h.db.select().from(schema.musicLink)).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
      resetServerEnv();
      await h.close();
    }
  });
});
