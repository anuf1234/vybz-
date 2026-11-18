import { WARS } from "@vybz/core";
import { type DbHandle, eq, schema } from "@vybz/db";
import { AppleMusicAdapter, DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { closeDueWars, createWar, getWar, listWars, searchAlbums, trendingAlbums, voteWar, warRankings } from "../src/server/wars";
import { TEST_DB_URL, freshDb } from "./helpers";

describe("Apple Music albums", () => {
  it("reads an album with its tracks, and strips ' - Single'", async () => {
    const song = (id: string, name: string, n: number) => ({ id, type: "songs", attributes: { name, artistName: "Usher", albumName: "Confessions", trackNumber: n, durationInMillis: 200000, previews: [{ url: `https://audio-ssl.itunes.apple.com/${id}.m4a` }] } });
    const fetchStub = async (url: string) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes("/albums/")) {
        return json({ data: [{ id: "123", attributes: { name: "Confessions", artistName: "Usher", releaseDate: "2004-03-23", trackCount: 2, isSingle: false, artwork: { url: "https://is1-ssl.mzstatic.com/x/{w}x{h}bb.jpg" } }, relationships: { tracks: { data: [song("1", "Intro", 1), song("2", "Yeah!", 2)] } } }] });
      }
      if (url.includes("types=albums")) return json({ results: { albums: { data: [{ id: "9", attributes: { name: "Burn - Single", artistName: "Usher", isSingle: true } }] } } });
      return json({});
    };
    const apple = new AppleMusicAdapter({ developerToken: async () => "t", fetch: fetchStub as never });
    const al = await apple.getAlbum("123", { storefront: "us" });
    expect(al).toMatchObject({ title: "Confessions", releaseYear: 2004, isSingle: false });
    expect(al!.tracks!.map((t) => t.title)).toEqual(["Intro", "Yeah!"]);
    expect(al!.artwork!.url).toBe("https://is1-ssl.mzstatic.com/x/600x600bb.jpg");
    const hits = await apple.searchAlbums("burn", { storefront: "us" });
    expect(hits[0]).toMatchObject({ title: "Burn", isSingle: true });
  });
});

describe.skipIf(!TEST_DB_URL)("step 10: album and single wars", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let ava: UserRow;
  let ben: UserRow;
  let cleo: UserRow;
  let warId: string;

  beforeAll(async () => {
    h = await freshDb();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    [ava, ben, cleo] = (await h.db
      .insert(schema.user)
      .values([
        { id: "u_a", name: "Ava", email: "a@x.com", handle: "ava" },
        { id: "u_b", name: "Ben", email: "b@x.com", handle: "ben" },
        { id: "u_c", name: "Cleo", email: "c@x.com", handle: "cleo" },
      ])
      .returning()) as [UserRow, UserRow, UserRow];
  });
  afterAll(() => h?.close());

  it("finds albums and what's trending", async () => {
    const hits = await searchAlbums(deps, "harbor");
    expect(hits).toEqual([expect.objectContaining({ ref: "VYBZ_DEMO:harbor-nights", title: "Harbor Nights", trackCount: 2 })]);
    expect((await trendingAlbums(deps)).length).toBe(4);
  });

  it("starts an album war with both track lists, and reuses an open matchup", async () => {
    const w = await createWar(deps, ava, { kind: "ALBUM", a: "VYBZ_DEMO:after-hours-tapes", b: "VYBZ_DEMO:velvet-and-glass" });
    warId = w.id;
    expect(w).toMatchObject({ kind: "ALBUM", status: "OPEN", title: "After Hours Tapes vs Velvet & Glass", voters: 0 });
    expect(w.a.tracks.map((t) => t.title)).toEqual(["Neon Hallway", "Midnight Static"]);
    expect(w.categories.map((c) => c.key)).toEqual(["overall", "songs", "production", "lyrics", "replay"]);
    expect(w.tracks).toHaveLength(2);
    const again = await createWar(deps, ben, { kind: "ALBUM", a: "VYBZ_DEMO:velvet-and-glass", b: "VYBZ_DEMO:after-hours-tapes" });
    expect(again.id).toBe(w.id);
    await expect(createWar(deps, ava, { a: "VYBZ_DEMO:x", b: "VYBZ_DEMO:x" })).rejects.toMatchObject({ code: "INVALID_SIDE" });
    await expect(createWar(deps, ava, { a: "VYBZ_DEMO:nope", b: "VYBZ_DEMO:harbor-nights" })).rejects.toMatchObject({ code: "ALBUM_NOT_FOUND" });
    await expect(createWar(deps, null, { a: "VYBZ_DEMO:harbor-nights", b: "VYBZ_DEMO:satellite-drive" })).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
  });

  it("votes by category and track, hides counts until you vote, pays a little XP once", async () => {
    let v = await voteWar(deps, ava, warId, { category: "overall", side: "A" });
    expect(v.categories[0]).toMatchObject({ key: "overall", a: 1, b: 0, mine: "A" });
    expect(v.categories[1]).toMatchObject({ key: "songs", a: null, b: null });
    await voteWar(deps, ava, warId, { category: "production", side: "B" });
    await voteWar(deps, ava, warId, { category: "t1", side: "B" });
    await expect(voteWar(deps, ava, warId, { category: "t3", side: "A" })).rejects.toMatchObject({ code: "INVALID_CATEGORY" });
    await expect(voteWar(deps, ava, warId, { category: "vibes", side: "A" })).rejects.toMatchObject({ code: "INVALID_CATEGORY" });
    await voteWar(deps, ben, warId, { category: "overall", side: "B" });
    await voteWar(deps, cleo, warId, { category: "overall", side: "A" });
    // Changing your mind replaces your vote.
    v = await voteWar(deps, ben, warId, { category: "overall", side: "A" });
    expect(v.categories[0]).toMatchObject({ a: 3, b: 0 });
    expect(v.voters).toBe(3);
    v = await getWar(deps, null, warId);
    expect(v.categories[0]).toMatchObject({ a: null, b: null });
    const xp = await h.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.reason, "WAR_VOTE"));
    expect(xp).toHaveLength(3);
    expect(xp[0]!.xp).toBe(WARS.voteXp);
    const list = await listWars(deps, ava, new URLSearchParams());
    expect(list.items[0]).toMatchObject({ id: warId, voters: 3, voted: true });
  });

  it("runs single wars on songs", async () => {
    const w = await createWar(deps, ben, { kind: "SINGLE", a: "VYBZ_DEMO:pulse-garden", b: "VYBZ_DEMO:glass-parade" });
    expect(w).toMatchObject({ kind: "SINGLE", title: "Pulse Garden vs Glass Parade", tracks: [] });
    expect(w.categories.map((c) => c.key)).toEqual(["overall", "production", "lyrics", "replay"]);
    await voteWar(deps, ava, w.id, { category: "overall", side: "B" });
  });

  it("closes after a week, names the winner, and ranks albums", async () => {
    await h.db.update(schema.war).set({ closesAt: new Date(Date.now() - 1000) }).where(eq(schema.war.id, warId));
    expect(await closeDueWars(deps)).toBe(1);
    const v = await getWar(deps, ben, warId);
    expect(v).toMatchObject({ status: "CLOSED", winner: "A" });
    expect(v.categories[0]).toMatchObject({ a: 3, b: 0 });
    await expect(voteWar(deps, ben, warId, { category: "songs", side: "A" })).rejects.toMatchObject({ code: "WAR_CLOSED" });
    const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.userId, ava.id));
    expect(notes.map((n) => n.type)).toContain("WAR_RESULT");
    const r = await warRankings(deps, new URLSearchParams({ kind: "ALBUM", period: "week" }));
    expect(r.rows[0]).toMatchObject({ title: "After Hours Tapes", votes: 3, wars: 1, wins: 1, share: 100 });
    const singles = await warRankings(deps, new URLSearchParams({ kind: "SINGLE", period: "year" }));
    expect(singles.rows[0]!.title).toBe("Glass Parade");
    // A new war on the same pair can start once the old one closed.
    const again = await createWar(deps, cleo, { kind: "ALBUM", a: "VYBZ_DEMO:after-hours-tapes", b: "VYBZ_DEMO:velvet-and-glass" });
    expect(again.id).not.toBe(warId);
  });
});
