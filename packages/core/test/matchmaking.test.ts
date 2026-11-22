import { describe, expect, it } from "vitest";
import { MATCHMAKING, rankMatches, regionOf } from "../src/matchmaking";

const me: { genre: string | null; decade: number | null; rating: number; region: string | null } = { genre: "rnb", decade: 2000, rating: 1000, region: "America" };
const w = (id: string, o: Partial<typeof me> & { waitingMs?: number } = {}) => ({ id, genre: "rnb", decade: 2000, rating: 1000, region: "America", waitingMs: 10_000, ...o });

describe("rankMatches", () => {
  it("prefers the exact vibe, then closer skill, then the same region", () => {
    const r = rankMatches(me, [w("far", { rating: 1400 }), w("eu", { region: "Europe" }), w("best"), w("anyEra", { decade: null })], { ranked: false });
    expect(r.map((x) => x.id)).toEqual(["best", "eu", "anyEra", "far"]);
  });

  it("only takes a different genre or era once the other player has waited long enough", () => {
    const rock = w("rock", { genre: "rock" });
    expect(rankMatches(me, [rock], { ranked: false })).toEqual([]);
    const widened = rankMatches(me, [{ ...rock, waitingMs: MATCHMAKING.widenGenreMs }], { ranked: false });
    expect(widened[0]).toMatchObject({ id: "rock", genre: "rnb", decade: 2000, widened: true });
    expect(rankMatches(me, [w("90s", { decade: 1990, waitingMs: MATCHMAKING.widenEraMs })], { ranked: false })[0]).toMatchObject({ decade: 2000, widened: true });
  });

  it("fills an open preference with the other side's choice", () => {
    const r = rankMatches({ ...me, genre: null }, [w("x", { genre: "jazz" })], { ranked: false });
    expect(r[0]).toMatchObject({ genre: "jazz", widened: false });
    expect(rankMatches(me, [w("y", { genre: null })], { ranked: false })[0]).toMatchObject({ genre: "rnb", widened: true });
  });

  it("keeps ranked inside the rating window", () => {
    expect(rankMatches(me, [w("x", { rating: 1300 })], { ranked: true })).toEqual([]);
    expect(rankMatches(me, [w("x", { rating: 1300, waitingMs: 4 * 60_000 })], { ranked: true })).toHaveLength(1);
  });

  it("reads regions from time zones", () => {
    expect(regionOf("America/New_York")).toBe("America");
    expect(regionOf("Africa/Lagos")).toBe("Africa");
    expect(regionOf("UTC")).toBeNull();
    expect(regionOf(null)).toBeNull();
  });
});
