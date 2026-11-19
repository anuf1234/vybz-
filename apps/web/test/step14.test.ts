import { type DbHandle, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artistPage, challengeArtist, claimArtistProfile, myArtistProfile, pendingArtistProfiles, reviewArtistProfile } from "../src/server/artists";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { profile } from "../src/server/battles/service";
import { forgetBot } from "../src/server/bot";
import { followArtist, listDrops, runDailyDrops } from "../src/server/drops";
import { TEST_DB_URL, freshDb } from "./helpers";

describe.skipIf(!TEST_DB_URL)("artist profiles and challenges", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let kaia: UserRow;
  let fan: UserRow;
  let mod: UserRow;
  let imposter: UserRow;

  beforeAll(async () => {
    h = await freshDb();
    forgetBot();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    [kaia, fan, mod, imposter] = (await h.db
      .insert(schema.user)
      .values([
        { id: "u_k", name: "Kaia", email: "k@x.com", handle: "kaia" },
        { id: "u_f", name: "Fan", email: "f@x.com", handle: "fan" },
        { id: "u_m", name: "Mod", email: "m@x.com", handle: "mod", role: "MODERATOR" },
        { id: "u_i", name: "Imp", email: "i@x.com", handle: "imp" },
      ])
      .returning()) as [UserRow, UserRow, UserRow, UserRow];
    await runDailyDrops(deps, { force: true });
  });
  afterAll(() => h?.close());

  it("claims with a posted code, gets verified once, and shows a badge", async () => {
    const { code } = await myArtistProfile(deps, kaia);
    expect(code).toMatch(/^VYBZ-[0-9A-F]{6}$/);
    await expect(claimArtistProfile(deps, kaia, { name: "Kaia Stone", code, proofUrl: "not a link" })).rejects.toMatchObject({ code: "INVALID_PROOF" });
    const p = await claimArtistProfile(deps, kaia, { name: "Kaia Stone", code, proofUrl: "https://instagram.com/p/abc", links: { instagram: "https://instagram.com/kaia", website: "javascript:alert(1)" } });
    expect(p).toMatchObject({ status: "PENDING", code, links: { instagram: "https://instagram.com/kaia" } });
    // The public never sees the code or proof.
    const imp = await myArtistProfile(deps, imposter);
    await claimArtistProfile(deps, imposter, { name: "kaia stone", code: imp.code, proofUrl: "https://x.com/fake" });
    await expect(pendingArtistProfiles(deps, fan)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const pending = await pendingArtistProfiles(deps, mod);
    expect(pending.items).toHaveLength(2);
    await reviewArtistProfile(deps, mod, p.id, { action: "verify" });
    // Only one verified profile per artist name.
    const impId = pending.items.find((x) => x.owner.handle === "imp")!.id;
    await expect(reviewArtistProfile(deps, mod, impId, { action: "verify" })).rejects.toMatchObject({ code: "ARTIST_TAKEN" });
    expect((await profile(deps, null, "kaia")).artist).toEqual({ name: "Kaia Stone" });

    const page = await artistPage(deps, null, "kaia stone");
    expect(page.name).toBe("Kaia Stone");
    expect(page.profile).toMatchObject({ status: "VERIFIED", code: null, proofUrl: null, owner: { handle: "kaia" } });
    expect(page.releases.length).toBeGreaterThan(0);
  });

  it("lets a verified artist call out another artist; fans and the rival hear about it", async () => {
    const { items } = await listDrops(deps, fan, new URLSearchParams());
    const myAlbum = items.find((x) => x.artistName === "Kaia Stone" && x.kind === "ALBUM")!;
    const mySingle = items.find((x) => x.artistName === "Kaia Stone" && x.kind === "SINGLE")!;
    const theirAlbum = items.find((x) => x.artistName === "Dune Theory" && x.kind === "ALBUM")!;
    await followArtist(deps, fan, { releaseId: theirAlbum.id });

    await expect(challengeArtist(deps, fan, { mine: myAlbum.id, theirs: theirAlbum.id })).rejects.toMatchObject({ code: "NOT_AN_ARTIST" });
    await expect(challengeArtist(deps, kaia, { mine: theirAlbum.id, theirs: myAlbum.id })).rejects.toMatchObject({ code: "NOT_YOUR_RELEASE" });
    await expect(challengeArtist(deps, kaia, { mine: mySingle.id, theirs: theirAlbum.id })).rejects.toMatchObject({ code: "KIND_MISMATCH" });
    const war = await challengeArtist(deps, kaia, { mine: myAlbum.id, theirs: theirAlbum.id });
    expect(war.challenge).toEqual({ from: "Kaia Stone", to: "Dune Theory", fromHandle: "kaia" });
    expect(war.a.artistName).toBe("Kaia Stone");
    const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.userId, fan.id));
    expect(notes.some((n) => n.title.includes("Kaia Stone challenged Dune Theory") && n.link === `/wars/${war.id}`)).toBe(true);
    const page = await artistPage(deps, null, "Kaia Stone");
    expect(page.wars.open).toBeGreaterThanOrEqual(1);
    expect(page.wars.recent.some((w) => w.id === war.id && w.challenge)).toBe(true);
  });
});

describe("ranked rules", () => {
  it("rates, divides and resets", async () => {
    const { eloDelta, divisionOf, softReset, seasonOf, matchWindow, bracketOrder, roundName } = await import("@vybz/core");
    expect(eloDelta(1000, 1000, 1)).toBe(16);
    expect(eloDelta(1000, 1000, 0)).toBe(-16);
    expect(eloDelta(1400, 1000, 1)).toBeLessThan(4);
    expect(divisionOf(1000).key).toBe("BRONZE");
    expect(divisionOf(1150).key).toBe("GOLD");
    expect(divisionOf(2000).key).toBe("LEGEND");
    expect(softReset(1400)).toBe(1200);
    expect(seasonOf(new Date("2026-11-18T00:00:00Z"))).toBe("2026-Q4");
    expect(matchWindow(0)).toBe(150);
    expect(matchWindow(30 * 60_000)).toBe(400);
    expect(bracketOrder(8)).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
    expect(roundName(16, 0)).toBe("Round of 16");
    expect(roundName(16, 3)).toBe("Final");
  });
});

describe.skipIf(!TEST_DB_URL)("ranked battles", () => {
  it("matches by rating, never the bot, and applies the result once", async () => {
    const h = await freshDb();
    forgetBot();
    try {
      const { quickBattle } = await import("../src/server/quick");
      const { loadBattle } = await import("../src/server/battles/repo");
      const { applyRanked, rankedBoard, ratingFor } = await import("../src/server/ranked");
      const { DemoJudge } = await import("../src/server/ai-judge");
      const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
      const deps: BattleDeps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: new DemoJudge() };
      const [a, b, c] = (await h.db
        .insert(schema.user)
        .values([
          { id: "u_a", name: "A", email: "a@x.com", handle: "ranka" },
          { id: "u_b", name: "B", email: "b@x.com", handle: "rankb" },
          { id: "u_c", name: "C", email: "c@x.com", handle: "rankc" },
        ])
        .returning()) as [UserRow, UserRow, UserRow];
      await expect(quickBattle(deps, a, { ranked: true, vsBot: true })).rejects.toMatchObject({ code: "RANKED_NO_BOT" });
      // c is far above a: not matched.
      await ratingFor(h.db, c.id);
      await h.db.update(schema.userRating).set({ rating: 1600 }).where(eq(schema.userRating.userId, c.id));
      const first = await quickBattle(deps, a, { ranked: true });
      expect(first.matched).toBe("waiting");
      expect((await quickBattle(deps, c, { ranked: true })).matched).toBe("waiting");
      // An unranked quick battle never takes a ranked one.
      expect((await quickBattle(deps, b, {})).matched).toBe("waiting");
      const m = await quickBattle(deps, b, { ranked: true });
      expect(m).toEqual({ id: first.id, matched: "player" });

      const loaded = (await loadBattle(h.db, first.id))!;
      const agg = loaded.aggregate;
      const pa = agg.participants.find((p) => p.userId === a.id)!;
      const done = { ...agg, status: "COMPLETE" as const, winnerParticipantId: pa.id };
      expect(await applyRanked(h.db, null, done)).toBe(true);
      expect(await applyRanked(h.db, null, done)).toBe(false);
      const board = await rankedBoard(deps, a);
      expect(board.me).toMatchObject({ rating: 1024, games: 1, wins: 1, placement: true, division: "BRONZE" });
      expect(board.top.map((r) => [r.user.handle, r.rating])).toEqual([
        ["ranka", 1024],
        ["rankb", 976],
      ]);
      const { profile } = await import("../src/server/battles/service");
      expect((await profile(deps, null, "ranka")).rank).toMatchObject({ rating: 1024, divisionLabel: "Bronze", placement: true });
    } finally {
      await h.close();
    }
  });
});

describe.skipIf(!TEST_DB_URL)("tournaments", () => {
  it("runs an 8-song bracket to a champion; ties go to the higher seed", async () => {
    const h = await freshDb();
    forgetBot();
    try {
      const { createTournament, voteTournament, advanceTournaments, getTournament, listTournaments } = await import("../src/server/tournaments");
      const { DEMO_TRACKS } = await import("@vybz/providers");
      const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
      const deps: BattleDeps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
      const [mod, v1, v2] = (await h.db
        .insert(schema.user)
        .values([
          { id: "u_m", name: "M", email: "m@x.com", handle: "tmod", role: "MODERATOR" },
          { id: "u_1", name: "1", email: "1@x.com", handle: "tv1" },
          { id: "u_2", name: "2", email: "2@x.com", handle: "tv2" },
        ])
        .returning()) as [UserRow, UserRow, UserRow];
      const ids = DEMO_TRACKS.slice(0, 8).map((t) => `VYBZ_DEMO:${t.id}`);
      await expect(createTournament(deps, v1, { title: "Best demo song", catalogIds: ids })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(createTournament(deps, mod, { title: "Best demo song", catalogIds: ids.slice(0, 5) })).rejects.toMatchObject({ code: "INVALID_SIZE" });
      const start = new Date();
      let t = await createTournament(deps, mod, { title: "Best demo song", catalogIds: ids }, start);
      expect(t.rounds[0]!.name).toBe("Quarterfinals");
      expect(t.rounds[0]!.matches.map((m) => [m.a, m.b])).toEqual([
        [0, 7],
        [3, 4],
        [1, 6],
        [2, 5],
      ]);
      // Seed 8 upsets seed 1; the others get no votes (higher seed wins the tie).
      t = await voteTournament(deps, v1, t.id, { match: 0, entry: 7 }, start);
      expect(t.rounds[0]!.matches[0]).toMatchObject({ votesA: 0, votesB: 1, mine: 7 });
      await voteTournament(deps, v2, t.id, { match: 0, entry: 7 }, start);
      await expect(voteTournament(deps, v1, t.id, { match: 0, entry: 3 }, start)).rejects.toMatchObject({ code: "INVALID_VOTE" });
      const hours = (n: number) => new Date(start.getTime() + n * 3600_000);
      expect(await advanceTournaments(deps, hours(43))).toBe(1);
      t = await getTournament(deps, v1, t.id);
      expect(t.rounds[1]!.name).toBe("Semifinals");
      expect(t.rounds[1]!.matches.map((m) => [m.a, m.b])).toEqual([
        [7, 3],
        [1, 2],
      ]);
      await advanceTournaments(deps, hours(86));
      await advanceTournaments(deps, hours(129));
      t = await getTournament(deps, v1, t.id);
      expect(t.status).toBe("DONE");
      expect(t.champion).toBe(1);
      expect(t.rounds).toHaveLength(3);
      const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.userId, v1.id));
      expect(notes.some((n) => n.type === "TOURNAMENT" && n.title.includes("wins"))).toBe(true);
      expect((await listTournaments(deps)).items[0]).toMatchObject({ status: "DONE", size: 8, voters: 2 });
    } finally {
      await h.close();
    }
  });
});
