import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, DAILY_LADDER, boolRuns, dayRuns, ladderDay } from "../src/progression";

describe("progression rules", () => {
  it("has unique achievement codes", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.code)).size).toBe(ACHIEVEMENTS.length);
  });

  it("cycles the daily ladder every 7 days", () => {
    expect(DAILY_LADDER).toHaveLength(7);
    expect([1, 2, 7, 8, 14, 15].map(ladderDay)).toEqual([1, 2, 7, 1, 7, 1]);
  });

  it("counts runs of days", () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-10", "2026-01-11"];
    expect(dayRuns(days, "2026-01-12")).toEqual({ current: 2, best: 3 });
    expect(dayRuns(days, "2026-01-11")).toEqual({ current: 2, best: 3 });
    expect(dayRuns(days, "2026-01-13")).toEqual({ current: 0, best: 3 });
    expect(dayRuns(["2026-02-28", "2026-03-01"], "2026-03-01")).toEqual({ current: 2, best: 2 });
    expect(dayRuns([], "2026-01-01")).toEqual({ current: 0, best: 0 });
  });

  it("counts runs of wins", () => {
    expect(boolRuns([true, true, false, true])).toEqual({ current: 1, best: 2 });
    expect(boolRuns([])).toEqual({ current: 0, best: 0 });
  });
});
