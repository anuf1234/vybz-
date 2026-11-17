import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, DAILY_LADDER, ladderDay } from "../src/progression";

describe("progression rules", () => {
  it("has unique achievement codes", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.code)).size).toBe(ACHIEVEMENTS.length);
  });

  it("cycles the daily ladder every 7 days", () => {
    expect(DAILY_LADDER).toHaveLength(7);
    expect([1, 2, 7, 8, 14, 15].map(ladderDay)).toEqual([1, 2, 7, 1, 7, 1]);
  });
});
