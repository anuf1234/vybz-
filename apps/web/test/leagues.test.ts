import { type DbHandle, eq, newId, schema } from "@vybz/db";
import { isoWeek } from "@vybz/core";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { assignLeagues, closeLeagueWeeks, leagueView } from "../src/server/leagues";
import { ratingFor } from "../src/server/ranked";
import { TEST_DB_URL, freshDb } from "./helpers";

describe.skipIf(!TEST_DB_URL)("weekly leagues and season badges", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  // A Wednesday.
  let clock = new Date("2026-11-18T12:00:00Z").getTime();
  const users: UserRow[] = [];
  const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });

  beforeAll(async () => {
    h = await freshDb();
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null, now: () => new Date(clock) };
    for (let i = 0; i < 12; i++) {
      const [u] = await h.db.insert(schema.user).values({ id: `u${i}`, name: `P${i}`, email: `p${i}@x.com`, handle: `player${i}`, emailVerified: true }).returning();
      users.push(u!);
    }
    const [guest] = await h.db.insert(schema.user).values({ id: "ug", name: "Guest", email: "g@guest.vybz.invalid", handle: "guest_1", isAnonymous: true }).returning();
    // XP this week: player0 most, player11 least; the guest earns some too.
    for (const [i, u] of [...users, guest!].entries()) {
      await h.db.insert(schema.ledgerEntry).values({ id: newId(), userId: u.id, reason: "TEST", ref: "w47", xp: (12 - i) * 10, createdAt: new Date(clock - 3600_000) });
    }
  });
  afterAll(() => h?.close());

  it("groups this week's players by tier and ranks them by XP", async () => {
    expect(await assignLeagues(deps)).toBe(12); // not the guest
    expect(await assignLeagues(deps)).toBe(0);
    const v = await leagueView(deps, users[0]!);
    expect(v).toMatchObject({ week: "2026-W47", tier: 0, league: { key: "OPENER" }, myRank: 1 });
    expect(v.standings).toHaveLength(12);
    expect(v.standings![0]).toMatchObject({ zone: "UP", me: true, xp: 120 });
    expect(v.standings![11]!.zone).toBeNull(); // nobody drops out of the bottom league
  });

  it("closes the week: the top move up and hear about it", async () => {
    clock = new Date("2026-11-23T00:10:00Z").getTime(); // Monday
    expect(await closeLeagueWeeks(deps)).toBe(1);
    const rows = await h.db.select().from(schema.leagueMember).where(eq(schema.leagueMember.week, "2026-W47"));
    expect(rows.filter((r) => r.outcome === "PROMOTED").map((r) => r.userId).sort()).toEqual(["u0", "u1", "u2", "u3", "u4", "u5", "u6"]);
    const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.userId, "u0"));
    expect(notes[0]).toMatchObject({ type: "LEAGUE", link: "/leagues" });
    expect(notes[0]!.title).toContain("Mixtape");
    // Next week they start a tier up.
    await h.db.insert(schema.ledgerEntry).values({ id: newId(), userId: "u0", reason: "TEST", ref: "w48", xp: 5, createdAt: new Date(clock) });
    expect(await assignLeagues(deps)).toBe(1);
    const next = await leagueView(deps, users[0]!);
    expect(next).toMatchObject({ week: isoWeek(new Date(clock)), tier: 1, league: { key: "MIXTAPE" }, last: { outcome: "PROMOTED", rank: 1 } });
  });

  it("turns last season's peak into a badge when the new season starts", async () => {
    await h.db.insert(schema.userRating).values({ userId: "u1", season: "2026-Q3", rating: 1180, peak: 1260, games: 9, wins: 6, losses: 3, draws: 0 });
    const r = await ratingFor(h.db, "u1", new Date("2026-11-23T00:00:00Z"));
    expect(r.season).toBe("2026-Q4");
    const badges = await h.db.select().from(schema.seasonBadge).where(eq(schema.seasonBadge.userId, "u1"));
    expect(badges).toEqual([expect.objectContaining({ season: "2026-Q3", division: "PLATINUM", peak: 1260 })]);
    expect((await leagueView(deps, users[1]!)).badges[0]).toMatchObject({ season: "2026-Q3", label: "Platinum" });
  });
});
