import { DROPS, isFresh, mixtapeHost, releaseKind } from "@vybz/core";
import { type DbHandle, and, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { forgetBot } from "../src/server/bot";
import { fireRelease, followArtist, listDrops, mixtapeKey, myArtists, pendingMixtapes, reviewMixtape, runDailyDrops, sendDailyDigest, submitMixtape, todayFor, unfollowArtist } from "../src/server/drops";
import { recordActivity, vybzStreak } from "../src/server/vybz-streak";
import { TEST_DB_URL, freshDb } from "./helpers";

describe("drops rules", () => {
  it("classifies releases and dates", () => {
    expect(releaseKind({ title: "Song", isSingle: true })).toBe("SINGLE");
    expect(releaseKind({ title: "Night Moves EP" })).toBe("EP");
    expect(releaseKind({ title: "Big Record", trackCount: 14 })).toBe("ALBUM");
    expect(releaseKind({ title: "Short", trackCount: 5 })).toBe("EP");
    expect(isFresh("2026-11-10", "2026-11-18")).toBe(true);
    expect(isFresh("2026-10-01", "2026-11-18")).toBe(false);
    expect(isFresh("2026-11-20", "2026-11-18")).toBe(false);
    expect(isFresh(undefined, "2026-11-18")).toBe(false);
  });

  it("accepts mixtape links only from known music sites", () => {
    expect(mixtapeHost("https://soundcloud.com/artist/tape")).toBe("SoundCloud");
    expect(mixtapeHost("https://www.audiomack.com/artist/album/x")).toBe("Audiomack");
    expect(mixtapeHost("https://artist.bandcamp.com/album/x")).toBe("Bandcamp");
    expect(mixtapeHost("http://soundcloud.com/x")).toBeNull();
    expect(mixtapeHost("https://evil.example.com/soundcloud.com")).toBeNull();
    expect(mixtapeKey("https://www.youtube.com/watch?v=abc&t=3")).toBe("youtube.com/watch?v=abc");
    expect(mixtapeKey("https://SoundCloud.com/Artist/Tape/")).toBe("soundcloud.com/artist/tape");
  });
});

describe.skipIf(!TEST_DB_URL)("daily drops, the VYBZ streak and the daily push", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let fan: UserRow;
  let mod: UserRow;
  const pushed: { to: string; title: string; body: string }[] = [];

  beforeAll(async () => {
    h = await freshDb();
    forgetBot();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    deps = {
      db: h.db,
      catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" },
      requireVerifiedEmail: false,
      aiJudge: null,
      push: async (m) => void pushed.push(...m),
    };
    [fan, mod] = (await h.db
      .insert(schema.user)
      .values([
        { id: "u_fan", name: "Fan", email: "f@x.com", handle: "fan" },
        { id: "u_mod", name: "Mod", email: "m@x.com", handle: "mod", role: "MODERATOR" },
      ])
      .returning()) as [UserRow, UserRow];
    await h.db.insert(schema.userProgress).values({ userId: fan.id, timeZone: "America/New_York" });
  });
  afterAll(() => h?.close());

  it("waits for the post hour, then gathers drops once a day, posts them and opens wars", async () => {
    // Follow a demo artist first so the run notifies.
    await followArtist(deps, fan, { provider: "VYBZ_DEMO", externalId: "kaia-stone", name: "Kaia Stone" });
    const early = new Date();
    early.setUTCHours(DROPS.postHourUtc - 1, 0, 0, 0);
    expect((await runDailyDrops(deps, { now: early })).ran).toBe(false);

    const later = new Date();
    later.setUTCHours(DROPS.postHourUtc, 5, 0, 0);
    const r = await runDailyDrops(deps, { now: later });
    expect(r.ran).toBe(true);
    expect(r.added).toBeGreaterThanOrEqual(6);
    expect(r.postId).not.toBeNull();
    expect(r.wars).toBe(2);
    expect(r.notified).toBe(1);
    expect((await runDailyDrops(deps, { now: later })).ran).toBe(false);

    const [post] = await h.db.select().from(schema.post).where(eq(schema.post.id, r.postId!));
    expect(post!.body).toContain("Today's drops");
    const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.userId, fan.id));
    expect(notes.find((n) => n.type === "ARTIST_DROP")?.title).toContain("Kaia Stone");

    const today = await listDrops(deps, fan, new URLSearchParams());
    expect(today.items.length).toBe(r.added);
    expect(today.items.filter((x) => x.warId).length).toBe(4);
    const albums = await listDrops(deps, fan, new URLSearchParams("kind=ALBUM"));
    expect(albums.items.every((x) => x.kind === "ALBUM")).toBe(true);
    const following = await listDrops(deps, fan, new URLSearchParams("range=following"));
    expect(following.items.length).toBeGreaterThan(0);
    expect(following.items.every((x) => x.artistName === "Kaia Stone" && x.following)).toBe(true);
  });

  it("fires up a drop: XP once, counts for the streak, can be undone", async () => {
    const { items } = await listDrops(deps, fan, new URLSearchParams());
    const v = await fireRelease(deps, fan, items[0]!.id, { on: true });
    expect(v).toMatchObject({ fires: 1, fired: true });
    await fireRelease(deps, fan, items[0]!.id, { on: true });
    const ledger = await h.db.select().from(schema.ledgerEntry).where(and(eq(schema.ledgerEntry.userId, fan.id), eq(schema.ledgerEntry.reason, "DROP_FIRE")));
    expect(ledger).toHaveLength(1);
    expect((await vybzStreak(h.db, fan.id)).activeToday).toBe(true);
    expect(await fireRelease(deps, fan, items[0]!.id, { on: false })).toMatchObject({ fires: 0, fired: false });
  });

  it("covers missed days with streak freezes", async () => {
    const u = "u_streak";
    await h.db.insert(schema.user).values({ id: u, name: "S", email: "s@x.com", handle: "streaky" });
    await h.db.insert(schema.userProgress).values({ userId: u, timeZone: "UTC", streakFreezes: 1 });
    const d = (n: number) => new Date(Date.UTC(2026, 10, n, 15));
    await recordActivity(h.db, u, d(10));
    await recordActivity(h.db, u, d(11));
    await recordActivity(h.db, u, d(13)); // missed the 12th: the freeze covers it (10, 11, 12 frozen, 13)
    let s = await vybzStreak(h.db, u, d(13));
    expect(s).toMatchObject({ current: 4, best: 4, activeToday: true, freezes: 0 });
    await recordActivity(h.db, u, d(16)); // missed two days with no freezes left
    s = await vybzStreak(h.db, u, d(16));
    expect(s).toMatchObject({ current: 1, best: 4 });
  });

  it("follows and unfollows artists, including from a drop", async () => {
    const { items } = await listDrops(deps, fan, new URLSearchParams());
    const other = items.find((x) => x.artistName !== "Kaia Stone")!;
    const after = await followArtist(deps, fan, { releaseId: other.id });
    expect(after.items.map((a) => a.name)).toContain(other.artistName);
    await expect(followArtist(deps, fan, { provider: "APPLE_MUSIC", externalId: "1", name: "X" })).rejects.toMatchObject({ code: "INVALID_ARTIST" });
    await unfollowArtist(deps, fan, { name: other.artistName });
    expect((await myArtists(deps, fan)).items.map((a) => a.name)).not.toContain(other.artistName);
  });

  it("takes mixtape links for review; approved ones become drops", async () => {
    await expect(submitMixtape(deps, fan, { title: "Tape", artistName: "Me", url: "https://example.com/tape" })).rejects.toMatchObject({ code: "UNSUPPORTED_LINK" });
    const v = await submitMixtape(deps, fan, { title: "Summer Tape", artistName: "Lil Test", url: "https://soundcloud.com/liltest/summer-tape" });
    expect(v).toMatchObject({ kind: "MIXTAPE", status: "PENDING", host: "SoundCloud", ref: null });
    await expect(submitMixtape(deps, fan, { title: "Again", artistName: "Lil Test", url: "https://www.soundcloud.com/LilTest/summer-tape/" })).rejects.toMatchObject({ code: "MIXTAPE_EXISTS" });
    expect((await listDrops(deps, fan, new URLSearchParams("kind=MIXTAPE"))).items).toHaveLength(0);
    await expect(pendingMixtapes(deps, fan)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const pending = await pendingMixtapes(deps, mod);
    expect(pending.items.map((p) => p.title)).toEqual(["Summer Tape"]);
    await reviewMixtape(deps, mod, v.id, { action: "approve" });
    const live = await listDrops(deps, fan, new URLSearchParams("range=week&kind=MIXTAPE"));
    expect(live.items.map((x) => x.title)).toEqual(["Summer Tape"]);
    expect(live.items[0]!.submittedBy?.handle).toBe("fan");
  });

  it("shows today's card and sends one daily push at lunchtime", async () => {
    await h.db.insert(schema.pushToken).values({ userId: fan.id, token: "ExponentPushToken[fan]", platform: "ios" }).onConflictDoNothing();
    const t = await todayFor(deps, fan, "America/New_York");
    expect(t.drops.today).toBeGreaterThan(0);
    expect(t.drops.top.length).toBeGreaterThan(0);
    expect(t.trivia.done).toBe(false);
    expect(t.streak.activeToday).toBe(true);

    // 12:30 in New York.
    const noonNy = new Date();
    noonNy.setUTCHours(17, 30, 0, 0);
    const morning = new Date(noonNy.getTime() - 4 * 3600_000);
    pushed.length = 0;
    expect(await sendDailyDigest(h.db, deps.push, morning)).toBe(0);
    expect(await sendDailyDigest(h.db, deps.push, noonNy)).toBe(1);
    expect(await sendDailyDigest(h.db, deps.push, noonNy)).toBe(0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.body).toContain("Today's trivia is ready.");
  });
});
