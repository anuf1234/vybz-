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
    expect(t.songsToday.map((r) => [r.release.id, r.stats])).toEqual([
      [hot.id, { score: 12, fires: 4, wins: 0, listens: 0 }],
      [warm.id, { score: 2, fires: 0, wins: 0, listens: 2 }],
    ]);
    expect(t.songsWeek[0]!.release.id).toBe(hot.id);
    expect(t.albumsWeek[0]).toMatchObject({ rank: 1, release: { id: albums[1]!.id }, stats: { score: 5, fires: 1, wins: 1 } });
    expect(t.history).toEqual([]);
  });

  it("freezes the winners when the day and week end, posts them and tells the artist's fans", async () => {
    const { items } = await listDrops(deps, fans[0]!, new URLSearchParams());
    const hot = items.find((x) => x.kind === "SINGLE")!;
    await followArtist(deps, fans[3]!, { releaseId: hot.id });
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(await giveDropAwards(deps, tomorrow)).toBe(1);
    expect(await giveDropAwards(deps, tomorrow)).toBe(0);
    const nextWeek = new Date(Date.now() + 7 * 86_400_000);
    expect(await giveDropAwards(deps, nextWeek)).toBe(2);
    const awards = await h.db.select().from(schema.dropAward);
    expect(awards.map((a) => a.award).sort()).toEqual(["ALBUM_WEEK", "SONG_DAY", "SONG_WEEK"]);
    expect(awards.find((a) => a.award === "SONG_WEEK")!.period).toBe(isoWeek(new Date()));
    expect(awards.every((a) => a.postId)).toBe(true);
    const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.userId, fans[3]!.id));
    expect(notes.some((n) => n.type === "DROP_AWARD" && n.title.includes("Song of the Day"))).toBe(true);
    const t = await topDrops(deps, null);
    expect(t.history.map((x) => x.award)).toHaveLength(3);
  });
});
