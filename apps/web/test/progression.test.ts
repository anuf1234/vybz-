import { type DbHandle, and, eq, newId, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { leaderboard } from "../src/server/leaderboards";
import { achievementsFor, checkAchievements } from "../src/server/achievements";
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
});
