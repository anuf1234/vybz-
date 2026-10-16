import { describe, expect, it } from "vitest";
import {
  type BattleModel,
  type BattleRules,
  BattleRuleError,
  BattleRulesSchema,
  BattleThemeSchema,
  type Side,
  accept,
  advance,
  assertVotingOpen,
  cancel,
  creditListen,
  current,
  eraLabel,
  fitsEra,
  leftSideFor,
  newChallenge,
  requiredListenMs,
  scoreboard,
  submit,
} from "../src";

const H = 60 * 60 * 1000;
const t0 = new Date("2026-10-16T00:00:00Z");
const at = (hours: number) => new Date(t0.getTime() + hours * H);
const rules = (over: Partial<BattleRules> = {}): BattleRules => ({
  roundCount: 3,
  pace: "QUICK", // 1h picks, 1h voting
  eraFrom: null,
  eraTo: null,
  ...over,
});

function started(r = rules()): BattleModel {
  return accept(newChallenge(r, t0, false), t0);
}

/** Both sides pick at `h`, then voting runs with the given counts. */
function playRound(b: BattleModel, h: number, votes: [number, number]): BattleModel {
  const index = current(b)!.index;
  let next = submit(b, 0, index, at(h));
  next = submit(next, 1, index, at(h));
  const round = current(next)!;
  return { ...next, rounds: next.rounds.map((r) => (r.index === round.index ? { ...r, votes } : r)) };
}

describe("challenges", () => {
  it("opens, is accepted and starts round 1 with a pick deadline", () => {
    const b = started();
    expect(b.status).toBe("IN_PROGRESS");
    expect(b.rounds).toHaveLength(1);
    expect(current(b)).toMatchObject({ index: 0, status: "SUBMISSIONS_OPEN", submissionsCloseAt: at(1) });
  });

  it("expires after 72 hours without an opponent", () => {
    const b = advance(newChallenge(rules(), t0, true), at(72));
    expect(b).toMatchObject({ status: "EXPIRED", endedAt: at(72) });
    expect(() => accept(newChallenge(rules(), t0, false), at(73))).toThrow(BattleRuleError);
  });

  it("can't be accepted twice, and can only be cancelled before it starts", () => {
    const b = started();
    expect(() => accept(b, t0)).toThrow("isn't waiting");
    expect(() => cancel(b, t0)).toThrow("haven't started");
    expect(cancel(newChallenge(rules(), t0, false), t0).status).toBe("CANCELLED");
  });
});

describe("rounds", () => {
  it("opens voting once both sides pick, and rejects a second pick", () => {
    let b = submit(started(), 0, 0, at(0.5));
    expect(current(b)!.status).toBe("SUBMISSIONS_OPEN");
    expect(() => submit(b, 0, 0, at(0.5))).toThrow("already picked");
    b = submit(b, 1, 0, at(0.75));
    expect(current(b)).toMatchObject({ status: "VOTING_OPEN", votingClosesAt: at(1.75) });
    expect(() => assertVotingOpen(b, 0, at(1))).not.toThrow();
    expect(() => assertVotingOpen(b, 0, at(1.75))).toThrow("closed");
  });

  it("closes voting at the deadline, scores it and opens the next round at that moment", () => {
    const b = advance(playRound(started(), 0.5, [7, 3]), at(1.5));
    expect(b.rounds[0]).toMatchObject({ status: "CLOSED", winnerSide: 0, outcome: "VOTES" });
    expect(b.rounds[1]).toMatchObject({ status: "SUBMISSIONS_OPEN", openedAt: at(1.5), submissionsCloseAt: at(2.5) });
  });

  it("gives the round to the only side that picked", () => {
    const b = advance(submit(started(), 1, 0, at(0.2)), at(1));
    expect(b.rounds[0]).toMatchObject({ status: "CLOSED", winnerSide: 1, outcome: "FORFEIT" });
  });

  it("voids a round nobody picked for, and a tied vote is a draw", () => {
    expect(advance(started(), at(1)).rounds[0]).toMatchObject({ winnerSide: null, outcome: "VOID" });
    expect(advance(playRound(started(), 0, [4, 4]), at(1)).rounds[0]).toMatchObject({ winnerSide: null, outcome: "VOTES" });
  });

  it("rejects a pick for a round whose deadline passed, even if nobody has looked at the battle", () => {
    expect(() => submit(started(), 0, 0, at(1))).toThrow("closed");
    expect(() => submit(started(), 0, 1, at(0.5))).toThrow("closed");
  });
});

describe("results", () => {
  function playAll(results: [number, number][]): BattleModel {
    let b = started(rules({ roundCount: results.length as 3 }));
    for (const votes of results) {
      const openedAt = (current(b)!.openedAt.getTime() - t0.getTime()) / H;
      b = advance(playRound(b, openedAt, votes), at(openedAt + 1));
    }
    return b;
  }

  it("declares the side with more rounds the winner", () => {
    const b = playAll([
      [5, 1],
      [2, 6],
      [9, 8],
    ]);
    expect(b).toMatchObject({ status: "COMPLETE", winnerSide: 0 });
    expect(scoreboard(b).roundsWon).toEqual([2, 1]);
  });

  it("goes to one sudden-death round when level on rounds", () => {
    const b = playAll([
      [5, 1],
      [2, 6],
      [3, 3],
    ]);
    expect(b.status).toBe("IN_PROGRESS");
    expect(current(b)).toMatchObject({ suddenDeath: true, index: 3 });

    const openedAt = (current(b)!.openedAt.getTime() - t0.getTime()) / H;
    const done = advance(playRound(b, openedAt, [1, 4]), at(openedAt + 1));
    expect(done).toMatchObject({ status: "COMPLETE", winnerSide: 1 });
    expect(scoreboard(done).roundsWon).toEqual([1, 1]); // sudden death isn't a regular round win
  });

  it("falls back to total votes, then a draw, if sudden death is drawn", () => {
    let b = playAll([
      [5, 1],
      [2, 3],
      [3, 3],
    ]);
    const openedAt = (current(b)!.openedAt.getTime() - t0.getTime()) / H;
    b = advance(playRound(b, openedAt, [2, 2]), at(openedAt + 1));
    expect(b).toMatchObject({ status: "COMPLETE", winnerSide: 0 }); // 12 votes to 9

    let even = playAll([
      [3, 1],
      [1, 3],
      [2, 2],
    ]);
    const o2 = (current(even)!.openedAt.getTime() - t0.getTime()) / H;
    even = advance(playRound(even, o2, [0, 0]), at(o2 + 1));
    expect(even).toMatchObject({ status: "COMPLETE", winnerSide: null });
  });

  it("settles an abandoned battle in one call with the same timeline as a watched one", () => {
    const b = advance(started(rules({ roundCount: 3 })), at(100));
    expect(b.status).toBe("COMPLETE");
    // 3 void rounds, then a void sudden death, then 0–0 on votes: a draw at hour 4.
    expect(b.rounds.map((r) => r.outcome)).toEqual(["VOID", "VOID", "VOID", "VOID"]);
    expect(b).toMatchObject({ winnerSide: null, endedAt: at(4) });
  });
});

describe("rules", () => {
  it("validates round counts, eras and themes", () => {
    expect(BattleRulesSchema.safeParse(rules({ roundCount: 4 as 3 })).success).toBe(false);
    expect(BattleRulesSchema.safeParse(rules({ eraFrom: 2009, eraTo: 2000 })).success).toBe(false);
    expect(BattleThemeSchema.parse("  2000s R&B\u0007 ")).toBe("2000s R&B");
    expect(BattleThemeSchema.safeParse("ok").success).toBe(false);
  });

  it("checks release years against the era and labels it", () => {
    const r = rules({ eraFrom: 2000, eraTo: 2009 });
    expect([fitsEra(r, 1999), fitsEra(r, 2004), fitsEra(r, 2010), fitsEra(r, null)]).toEqual([false, true, false, true]);
    expect(eraLabel(r)).toBe("2000–2009");
    expect(eraLabel(rules({ eraFrom: 2010 }))).toBe("2010 or later");
    expect(eraLabel(rules())).toBeNull();
  });
});

describe("listening and presentation", () => {
  it("requires 20 seconds, or the whole of a shorter clip", () => {
    expect(requiredListenMs(null)).toBe(20_000);
    expect(requiredListenMs(30_000)).toBe(20_000);
    expect(requiredListenMs(12_000)).toBe(11_000);
  });

  it("never credits more listening than wall-clock time allows", () => {
    const startedAt = new Date(0);
    expect(creditListen({ previousMs: 0, reportedMs: 30_000, startedAt, now: new Date(3_000) })).toBe(5_000);
    expect(creditListen({ previousMs: 0, reportedMs: 15_000, startedAt, now: new Date(60_000) })).toBe(15_000);
    expect(creditListen({ previousMs: 18_000, reportedMs: 2_000, startedAt, now: new Date(60_000) })).toBe(18_000);
    expect(creditListen({ previousMs: 0, reportedMs: -5, startedAt, now: new Date(60_000) })).toBe(0);
  });

  it("shows sides in a stable order per voter that differs across voters", () => {
    expect(leftSideFor("u1", "r1")).toBe(leftSideFor("u1", "r1"));
    const sides = new Set<Side>(Array.from({ length: 20 }, (_, i) => leftSideFor(`user${i}`, "r1")));
    expect(sides).toEqual(new Set([0, 1]));
  });
});
