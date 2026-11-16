import { describe, expect, it } from "vitest";
import { countdown, entryLabel } from "../src/lib/format";
import { ListenTracker } from "../src/lib/listen-tracker";

describe("ListenTracker", () => {
  it("counts wall time while playing, not seeks", () => {
    const t = new ListenTracker();
    t.play(1_000);
    expect(t.playedMs(4_000)).toBe(3_000);
    t.pause(6_000);
    expect(t.playedMs(60_000)).toBe(5_000);
    t.play(70_000);
    t.play(71_000); // duplicate play events don't reset the clock
    t.pause(72_000);
    expect(t.playedMs(72_000)).toBe(7_000);
  });

  it("adopts server credit only when paused and only upwards", () => {
    const t = new ListenTracker(2_000);
    t.sync(9_000);
    expect(t.playedMs(0)).toBe(9_000);
    t.sync(1_000);
    expect(t.playedMs(0)).toBe(9_000);
  });
});

describe("format", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  it("formats countdowns", () => {
    expect(countdown(null, now)).toBeNull();
    expect(countdown("2026-11-01T11:00:00Z", now)).toBe("now");
    expect(countdown("2026-11-01T12:04:05Z", now)).toBe("4m 05s");
    expect(countdown("2026-11-01T15:30:00Z", now)).toBe("3h 30m");
    expect(countdown("2026-11-03T16:00:00Z", now)).toBe("2d 4h");
  });
  it("labels entries", () => {
    expect([entryLabel(0), entryLabel(1)]).toEqual(["A", "B"]);
  });
});
