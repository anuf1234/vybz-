import { describe, expect, it } from "vitest";
import { isoWeek, weekStart } from "../src/drops";
import { LEAGUES, leagueOutcome, nextTier, weekBounds } from "../src/leagues";

describe("leagues", () => {
  it("names ISO weeks and their Monday bounds", () => {
    expect(isoWeek(new Date("2026-11-21T12:00:00Z"))).toBe("2026-W47");
    expect(isoWeek(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    const { start, end } = weekBounds(new Date("2026-11-21T12:00:00Z"));
    expect(start.toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(weekStart("2026-W47").toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(weekStart("2026-W53").toISOString()).toBe("2026-12-28T00:00:00.000Z");
    expect(weekStart("2026-W01").toISOString()).toBe("2025-12-29T00:00:00.000Z");
  });

  it("moves the top up and the bottom down", () => {
    expect(leagueOutcome(1, 30, 2, 500)).toBe("PROMOTED");
    expect(leagueOutcome(7, 30, 2, 50)).toBe("PROMOTED");
    expect(leagueOutcome(8, 30, 2, 50)).toBe("STAYED");
    expect(leagueOutcome(26, 30, 2, 5)).toBe("DEMOTED");
    expect(leagueOutcome(25, 30, 2, 5)).toBe("STAYED");
    // Small groups: only the top 3 move, nobody drops.
    expect(leagueOutcome(3, 6, 1, 10)).toBe("PROMOTED");
    expect(leagueOutcome(6, 6, 1, 0)).toBe("STAYED");
    // Edges: no XP, no promotion; nowhere above the top or below the bottom.
    expect(leagueOutcome(1, 30, 2, 0)).toBe("STAYED");
    expect(leagueOutcome(1, 30, LEAGUES.length - 1, 900)).toBe("STAYED");
    expect(leagueOutcome(30, 30, 0, 0)).toBe("STAYED");
    expect(nextTier(0, "DEMOTED")).toBe(0);
    expect(nextTier(2, "PROMOTED")).toBe(3);
  });
});
