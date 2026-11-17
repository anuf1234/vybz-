import { type DbHandle, and, eq, newId, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { leaderboard } from "../src/server/leaderboards";
import { achievementsFor, checkAchievements } from "../src/server/achievements";
import { awardPost, awardVote, balanceOf, claimDaily, dailyState, grant, progressFor, wallet } from "../src/server/progression";
import { streaksFor } from "../src/server/streaks";
import { createPost, followUser } from "../src/server/social";
import { TEST_DB_URL, freshDb } from "./helpers";

/** A finished duel, written straight to the tables. */
export async function finishedDuel(
  h: DbHandle,
  a: UserRow,
  b: UserRow,
  o: { winner: "a" | "b" | null; aRounds: number; bRounds: number; daysAgo?: number; genres?: string[] },
) {
  const id = newId();
  const ended = new Date(Date.now() - (o.daysAgo ?? 0) * 86_400_000);
  const pa = newId();
  const pb = newId();
  await h.db.insert(schema.battle).values({
    id,
    status: "COMPLETE",
    title: "Test battle",
    rules: { roundCount: 3, constraints: o.genres ? { genres: o.genres } : undefined },
    roundCount: 3,
    creatorId: a.id,
    startedAt: ended,
    endedAt: ended,
    winnerParticipantId: o.winner === "a" ? pa : o.winner === "b" ? pb : null,
  });
  await h.db.insert(schema.battleParticipant).values([
    { id: pa, battleId: id, userId: a.id, side: 0, roundsWon: o.aRounds },
    { id: pb, battleId: id, userId: b.id, side: 1, roundsWon: o.bRounds },
  ]);
  return { id, pa, pb };
}

describe.skipIf(!TEST_DB_URL)("progression", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  const u: Record<string, UserRow> = {};
  const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });

  beforeAll(async () => {
    h = await freshDb();
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    for (const handle of ["ann", "bea", "cyd", "dee"]) {
      const [row] = await h.db.insert(schema.user).values({ id: `u_${handle}`, name: handle, email: `${handle}@x.com`, handle }).returning();
      u[handle] = row!;
    }
    // ann: 2 wins (one 40 days ago, R&B), bea: 1 win this week (hip-hop), cyd: 1 win this week but more rounds.
    await finishedDuel(h, u.ann!, u.bea!, { winner: "a", aRounds: 2, bRounds: 1, daysAgo: 40, genres: ["rnb"] });
    await finishedDuel(h, u.ann!, u.dee!, { winner: "a", aRounds: 2, bRounds: 0, daysAgo: 1, genres: ["rnb"] });
    await finishedDuel(h, u.bea!, u.dee!, { winner: "a", aRounds: 2, bRounds: 1, daysAgo: 2, genres: ["hiphop"] });
    await finishedDuel(h, u.cyd!, u.dee!, { winner: "a", aRounds: 3, bRounds: 0, daysAgo: 3 });
  });
  afterAll(() => h?.close());

  describe("leaderboards", () => {
    it("ranks all time by wins, then rounds", async () => {
      const lb = await leaderboard(deps, u.dee!, { scope: "global", period: "all", metric: "wins" });
      expect(lb.items.map((e) => [e.user.handle, e.rank, e.value])).toEqual([
        ["ann", 1, 2],
        ["cyd", 2, 1],
        ["bea", 2, 1],
        ["dee", 4, 0],
      ]);
      expect(lb.me).toMatchObject({ rank: 4, losses: 3, battles: 3 });
    });

    it("limits to the period", async () => {
      const week = await leaderboard(deps, null, { scope: "global", period: "week", metric: "wins" });
      expect(week.items.find((e) => e.user.handle === "ann")).toMatchObject({ wins: 1, battles: 1 });
      expect(week.me).toBeNull();
    });

    it("ranks by rounds won", async () => {
      const lb = await leaderboard(deps, null, { scope: "global", period: "week", metric: "rounds" });
      expect(lb.items[0]).toMatchObject({ user: expect.objectContaining({ handle: "cyd" }), value: 3 });
    });

    it("filters to a genre", async () => {
      const lb = await leaderboard(deps, null, { scope: "genre", genre: "rnb", period: "all", metric: "wins" });
      expect(lb.items.map((e) => e.user.handle).sort()).toEqual(["ann", "bea", "dee"]);
      expect(lb.items[0]).toMatchObject({ user: expect.objectContaining({ handle: "ann" }), wins: 2 });
    });

    it("shows you and the people you follow", async () => {
      await followUser(deps, u.dee!, "cyd");
      const lb = await leaderboard(deps, u.dee!, { scope: "following", period: "all", metric: "wins" });
      expect(lb.items.map((e) => e.user.handle)).toEqual(["cyd", "dee"]);
    });
  });

  describe("achievements", () => {
    it("unlocks what has been earned, once, and says so", async () => {
      const got = await checkAchievements(h.db, null, [u.ann!.id]);
      expect(got.map((d) => d.code).sort()).toEqual(["first_battle", "first_win", "flawless"]);
      expect(await checkAchievements(h.db, null, [u.ann!.id])).toEqual([]);
      const notes = await h.db
        .select()
        .from(schema.notification)
        .where(and(eq(schema.notification.userId, u.ann!.id), eq(schema.notification.type, "ACHIEVEMENT_UNLOCKED")));
      expect(notes).toHaveLength(3);
      expect(notes[0]!.link).toBe("/achievements");
      // Rewards land in the ledger: 25 + 50 + 75 XP, 10 + 15 + 25 coins, + 20 for reaching level 2.
      expect(await balanceOf(h.db, u.ann!.id)).toEqual({ xp: 150, coins: 70, level: 2 });
    });

    it("reports progress toward the rest", async () => {
      const res = await achievementsFor(h.db, u.ann!.id);
      expect(res).toMatchObject({ unlocked: 3, total: res.items.length });
      expect(res.items.slice(0, 3).every((i) => i.unlockedAt)).toBe(true);
      expect(res.items.find((i) => i.code === "battles_10")).toMatchObject({ progress: 2, target: 10, unlockedAt: null });
      expect(res.items.find((i) => i.code === "first_win")).toMatchObject({ progress: 1 });
    });

    it("checks after a post", async () => {
      await createPost(deps, u.bea!, { body: "first!" });
      const res = await achievementsFor(h.db, u.bea!.id);
      expect(res.items.find((i) => i.code === "first_post")?.unlockedAt).toBeTruthy();
    });
  });

  describe("daily rewards", () => {
    const at = (iso: string) => new Date(iso);
    const ny = { timeZone: "America/New_York" };

    it("climbs the ladder on consecutive days and resets after a gap", async () => {
      const c = u.cyd!;
      const before = await balanceOf(h.db, c.id);
      const d1 = await claimDaily(h.db, null, c, ny, at("2026-03-02T15:00:00Z"));
      expect(d1.reward).toEqual({ xp: 10, coins: 5 });
      expect(d1.state).toMatchObject({ today: "2026-03-02", claimedToday: true, canClaim: false, streak: 1, ladderDay: 1 });
      await expect(claimDaily(h.db, null, c, ny, at("2026-03-02T20:00:00Z"))).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });

      const open = await dailyState(h.db, c, "America/New_York", at("2026-03-03T14:00:00Z"));
      expect(open).toMatchObject({ claimedToday: false, canClaim: true, streak: 1, ladderDay: 2, reward: { xp: 15, coins: 5 } });
      expect((await claimDaily(h.db, null, c, ny, at("2026-03-03T14:00:00Z"))).state).toMatchObject({ streak: 2, ladderDay: 2 });

      // Skip the 4th: the 5th starts over.
      const after = await claimDaily(h.db, null, c, ny, at("2026-03-05T14:00:00Z"));
      expect(after.state).toMatchObject({ streak: 1, ladderDay: 1 });
      expect(after.state.balance.xp - before.xp).toBe(10 + 15 + 10);
    });

    it("counts days in your time zone", async () => {
      // 03:00 UTC on the 10th is still the 9th in New York (EDT).
      const s = await dailyState(h.db, u.dee!, "America/New_York", at("2026-03-10T03:00:00Z"));
      expect(s.today).toBe("2026-03-09");
      expect((await dailyState(h.db, u.dee!, "Not/AZone", at("2026-03-10T03:00:00Z"))).today).toBe("2026-03-10");
    });

    it("doesn't let a time-zone hop pay twice in a few hours", async () => {
      const d = u.dee!;
      await claimDaily(h.db, null, d, { timeZone: "Pacific/Honolulu" }, at("2026-04-01T08:00:00Z")); // Mar 31 there
      const hop = await dailyState(h.db, d, "Asia/Tokyo", at("2026-04-01T09:00:00Z")); // Apr 1 there
      expect(hop).toMatchObject({ today: "2026-04-01", canClaim: false });
      await expect(claimDaily(h.db, null, d, { timeZone: "Asia/Tokyo" }, at("2026-04-01T09:00:00Z"))).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });
      expect((await claimDaily(h.db, null, d, { timeZone: "Asia/Tokyo" }, at("2026-04-01T13:00:00Z"))).state.streak).toBe(2);
    });
  });

  describe("streaks", () => {
    it("tracks wins in a row and days played", async () => {
      // bea: lost 40 days ago, won 2 days ago; then two more wins today.
      await finishedDuel(h, u.bea!, u.dee!, { winner: "a", aRounds: 2, bRounds: 0 });
      await finishedDuel(h, u.bea!, u.cyd!, { winner: "a", aRounds: 2, bRounds: 1 });
      const s = await streaksFor(h.db, u.bea!.id);
      expect(s.wins).toEqual({ current: 3, best: 3 });
      expect(s.play.current).toBe(1);
      const got = await checkAchievements(h.db, null, [u.bea!.id]);
      expect(got.map((d) => d.code)).toContain("win_streak_3");
      // dee lost them all.
      expect((await streaksFor(h.db, u.dee!.id)).wins).toEqual({ current: 0, best: 0 });
    });

    it("tracks daily claims", async () => {
      const s = await streaksFor(h.db, u.cyd!.id, new Date("2026-03-05T20:00:00Z"));
      expect(s.daily).toEqual({ current: 1, best: 2 });
    });
  });

  describe("levels", () => {
    it("levels up once per level and pays the level-up coins", async () => {
      const [x] = await h.db.insert(schema.user).values({ id: "u_lev", name: "lev", email: "lev@x.com", handle: "lev" }).returning();
      expect(await grant(h.db, x!.id, "DAILY", "t1", { xp: 650, coins: 0 })).toEqual({ xp: 650, coins: 20 + 30 + 40, level: 4 });
      expect(await grant(h.db, x!.id, "DAILY", "t1", { xp: 650, coins: 0 })).toBeNull();
      const notes = await h.db.select().from(schema.notification).where(and(eq(schema.notification.userId, x!.id), eq(schema.notification.type, "LEVEL_UP")));
      expect(notes.map((n) => n.title)).toEqual(["⭐ Level 4"]);
      expect(await progressFor(h.db, x!.id)).toMatchObject({ level: 4, xp: 650, levelXp: 600, nextLevelXp: 1000, coins: 90 });

      // Level 5 unlocks "Rising" (+50 coins) on the next check.
      await grant(h.db, x!.id, "DAILY", "t2", { xp: 400, coins: 0 });
      const got = await checkAchievements(h.db, null, [x!.id]);
      expect(got.map((d) => d.code)).toEqual(["level_5"]);
      expect(await balanceOf(h.db, x!.id)).toEqual({ xp: 1050, coins: 90 + 50 + 50, level: 5 });
    });
  });

  describe("xp and coins", () => {
    it("pays for votes and posts up to a daily cap", async () => {
      const [x] = await h.db.insert(schema.user).values({ id: "u_cap", name: "cap", email: "cap@x.com", handle: "capper" }).returning();
      const day = new Date("2026-05-01T12:00:00Z");
      for (let i = 0; i < 12; i++) await awardVote(h.db, x!.id, "b_test", i, day);
      await awardVote(h.db, x!.id, "b_test", 0, day); // same round: once only
      for (let i = 0; i < 7; i++) await awardPost(h.db, x!.id, `p${i}`, day);
      // Caps are per UTC day, counted on entries made today.
      const w = await wallet(h.db, x!);
      const votes = w.history.filter((e) => e.reason === "VOTE").length;
      const posts = w.history.filter((e) => e.reason === "POST").length;
      expect(votes).toBe(10);
      expect(posts).toBe(5);
      expect(w.xp).toBe(10 * 2 + 5 * 5);
    });

    it("lists the wallet newest first with labels and pages", async () => {
      const w = await wallet(h.db, u.ann!);
      expect(w.history.length).toBeGreaterThan(0);
      expect(w.history.some((e) => e.reason === "ACHIEVEMENT" && e.label.includes("First win") && e.link === "/achievements")).toBe(true);
      expect(w.history.some((e) => e.reason === "LEVEL_UP" && e.label === "Reached level 2")).toBe(true);
      expect(w.nextCursor).toBeNull();
      await expect(wallet(h.db, null)).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
    });

    it("ranks by XP earned in the period", async () => {
      const lb = await leaderboard(deps, u.ann!, { scope: "global", period: "all", metric: "xp" });
      const values = lb.items.map((e) => e.value);
      expect(values).toEqual([...values].sort((a, b) => b - a));
      expect(lb.items.find((e) => e.user.handle === "lev")).toMatchObject({ level: 5, wins: 0 });
      expect(lb.me).toMatchObject({ wins: 2, level: 2 });
    });
  });
});
