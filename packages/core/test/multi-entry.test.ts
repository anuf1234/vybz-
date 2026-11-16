import { describe, expect, it } from "vitest";
import {
  type BattleAggregate,
  DURATION_PRESETS,
  acceptBattle,
  advance,
  battleOutcome,
  canRespond,
  checkVote,
  counterOffer,
  createBattle,
  currentRound,
  entryOrder,
  joinBattle,
  judgeRound,
  leaveBattle,
  parseRules,
  roundWinner,
  standings,
  startBattle,
  submitTrack,
  windowsForDuration,
} from "../src";

const T0 = new Date("2026-11-01T12:00:00Z");
let n = 0;
const at = (ms: number) => ({ now: new Date(T0.getTime() + ms), newId: () => `id${++n}` });
const MIN = 60_000;

const multi = (extra: object = {}) =>
  parseRules({ roundCount: 3, entrants: { min: 3, max: 4 }, timing: { submissionWindowMinutes: 10, votingWindowMinutes: 10 }, minVotesToCount: 0, ...extra });

const pid = (b: BattleAggregate, u: string) => b.participants.find((p) => p.userId === u)!.id;

function lobby(users: string[], extra: object = {}): BattleAggregate {
  let b = createBattle({ creatorId: "host", rules: multi(extra) }, at(0)).battle;
  for (const u of users) b = joinBattle(b, u, at(1)).battle;
  return b;
}

describe("multi-entry lobby", () => {
  it("fills seats and starts automatically when full", () => {
    let b = lobby(["a", "b"]);
    expect(b.status).toBe("OPEN_CHALLENGE");
    expect(b.participants.map((p) => [p.userId, p.side])).toEqual([["host", 0], ["a", 1], ["b", 2]]);
    expect(() => joinBattle(b, "a", at(2))).toThrow(expect.objectContaining({ code: "ALREADY_JOINED" }));
    b = joinBattle(b, "c", at(2)).battle;
    expect(b.status).toBe("IN_PROGRESS");
    expect(() => joinBattle(b, "d", at(3))).toThrow(expect.objectContaining({ code: "NOT_OPEN" }));
  });

  it("lets the host start early once the minimum has joined, and players leave before it starts", () => {
    let b = lobby(["a"]);
    expect(() => startBattle(b, "host", at(2))).toThrow(expect.objectContaining({ code: "NOT_ENOUGH_ENTRANTS" }));
    b = joinBattle(b, "b", at(2)).battle;
    expect(() => startBattle(b, "a", at(3))).toThrow(expect.objectContaining({ code: "NOT_CREATOR" }));
    const left = leaveBattle(b, "b").battle;
    expect(left.participants).toHaveLength(2);
    expect(joinBattle(left, "c", at(3)).battle.participants.find((p) => p.userId === "c")?.side).toBe(2); // reuses the freed seat
    expect(startBattle(b, "host", at(3)).battle.status).toBe("IN_PROGRESS");
  });

  it("starts at the join deadline with enough players, or expires", () => {
    const enough = lobby(["a", "b"], { challengeExpiryHours: 1 });
    expect(advance(enough, at(61 * MIN)).battle.status).toBe("IN_PROGRESS");
    const tooFew = lobby(["a"], { challengeExpiryHours: 1 });
    expect(advance(tooFew, at(61 * MIN)).battle.status).toBe("EXPIRED");
  });

  it("supports hosted battles where the creator doesn't play", () => {
    let b = createBattle({ creatorId: "vybz", rules: multi({ creatorPlays: false }) }, at(0)).battle;
    expect(b.participants).toEqual([]);
    expect(canRespond(b, "vybz", at(1).now)).toBe(true);
    for (const u of ["a", "b", "c"]) b = joinBattle(b, u, at(1)).battle;
    expect(b.participants.map((p) => p.side)).toEqual([0, 1, 2]);
    expect(() => createBattle({ creatorId: "x", rules: parseRules({ creatorPlays: false }) }, at(0))).toThrow(expect.objectContaining({ code: "INVALID_TERMS" }));
  });

  it("keeps duel-only actions off multi-entry battles", () => {
    const b = lobby(["a"]);
    expect(() => counterOffer(b, "a", multi({ roundCount: 5 }), at(2))).toThrow(expect.objectContaining({ code: "NOT_A_DUEL" }));
    expect(acceptBattle(b, "z", at(2)).battle.participants).toHaveLength(3); // accept = join
    expect(() => createBattle({ creatorId: "host", invitedUserId: "a", rules: multi() }, at(0))).toThrow(expect.objectContaining({ code: "NOT_A_DUEL" }));
  });
});

describe("multi-entry rounds", () => {
  function started(): BattleAggregate {
    return joinBattle(lobby(["a", "b"]), "c", at(2)).battle;
  }
  const submit = (b: BattleAggregate, u: string, t: string, ms = 3) =>
    submitTrack(b, { userId: u, roundIndex: currentRound(b)!.index, tracks: [{ id: t }] }, at(ms)).battle;

  it("opens voting when everyone has submitted, and voters pick among all entries", () => {
    let b = started();
    for (const [u, t] of [["host", "t0"], ["a", "t1"], ["b", "t2"]] as const) b = submit(b, u, t);
    expect(currentRound(b)!.status).toBe("SUBMISSIONS_OPEN");
    b = submit(b, "c", "t3");
    expect(currentRound(b)!.status).toBe("VOTING_OPEN");
    const voter = { userId: "v", emailVerified: true, createdAt: new Date(0), status: "ACTIVE" as const };
    const proofs = b.submissions.map((s) => ({ submissionId: s.id, playedMs: 30_000, tier: "EMBED" as const }));
    const q = { battle: b, roundIndex: 0, voter, alreadyVoted: false, submissions: [], now: at(5).now };
    expect(checkVote({ ...q, proofs: proofs.slice(0, 3) })).toBe("LISTEN_REQUIRED");
    expect(checkVote({ ...q, proofs, submissionId: b.submissions[2]!.id })).toBeNull();
    expect(checkVote({ ...q, voter: { ...voter, userId: "b" }, proofs })).toBe("PARTICIPANT");
  });

  it("missing players forfeit; the rest still go to a vote", () => {
    let b = started();
    b = submit(b, "a", "t1");
    b = submit(b, "b", "t2");
    b = advance(b, at(11 * MIN)).battle;
    const r = b.rounds[0]!;
    expect(r.status).toBe("VOTING_OPEN");
    expect(r.forfeitParticipantIds.sort()).toEqual([pid(b, "host"), pid(b, "c")].sort());
    // Votes only count among those present.
    b = { ...b, tallies: { [r.id]: { [pid(b, "a")]: { weighted: 1, count: 1 }, [pid(b, "b")]: { weighted: 3, count: 3 } } } };
    b = advance(b, at(22 * MIN)).battle;
    expect(b.rounds[0]!.winnerParticipantId).toBe(pid(b, "b"));
  });

  it("gives the round to the only player who submitted", () => {
    let b = started();
    b = submit(b, "c", "t9");
    b = advance(b, at(11 * MIN)).battle;
    expect(b.rounds[0]).toMatchObject({ status: "SCORED", winnerParticipantId: pid(b, "c") });
  });

  it("settles a tie on rounds with a sudden-death round for the tied leaders only", () => {
    let b = started();
    const ids = ["host", "a", "b", "c"].map((u) => pid(b, u));
    let t = 3;
    // Round wins: host, a, a? No: host, a, then a draw-ish split between host and a → 1–1 with equal shares.
    for (const winner of [0, 1]) {
      for (const [i, u] of ["host", "a", "b", "c"].entries()) b = submit(b, u, `r${t}-${i}`, t);
      const r = currentRound(b)!;
      b = { ...b, tallies: { ...b.tallies, [r.id]: { [ids[winner]!]: { weighted: 2, count: 2 } } } };
      t += 11 * MIN;
      b = advance(b, at(t)).battle;
    }
    // Round 3: nobody submits (draw).
    t += 11 * MIN;
    b = advance(b, at(t)).battle;
    expect(standings(b).leaders.sort()).toEqual([ids[0], ids[1]].sort());
    const sd = currentRound(b)!;
    expect(sd).toMatchObject({ suddenDeath: true, status: "SUBMISSIONS_OPEN" });
    expect(sd.contenderIds!.sort()).toEqual([ids[0], ids[1]].sort());
    expect(() => submit(b, "b", "nope", t + 1)).toThrow(expect.objectContaining({ code: "NOT_A_CONTENDER" }));
    // Only the two contenders need to submit for voting to open.
    b = submit(b, "host", "sd1", t + 1);
    b = submit(b, "a", "sd2", t + 1);
    expect(currentRound(b)!.status).toBe("VOTING_OPEN");
  });
});

describe("N-way scoring", () => {
  const tally = (xs: Record<string, number>) => Object.fromEntries(Object.entries(xs).map(([k, v]) => [k, { weighted: v, count: v }]));
  it("picks the unique top entry, falls back to count, else a draw", () => {
    expect(roundWinner(tally({ A: 2, B: 5, C: 1 }), ["A", "B", "C"])).toBe("B");
    expect(roundWinner(tally({ A: 3, B: 3, C: 1 }), ["A", "B", "C"])).toBeNull();
    expect(roundWinner({ A: { weighted: 2, count: 1 }, B: { weighted: 2, count: 3 } }, ["A", "B", "C"])).toBe("B");
  });
  it("combines crowd share and an AI pick across many entries", () => {
    // Crowd: A 50%, B 30%, C 20%; AI picks C at 40% → A .30, B .18, C .52.
    expect(judgeRound("COMBINED", 40, tally({ A: 5, B: 3, C: 2 }), "C", ["A", "B", "C"]).winnerParticipantId).toBe("C");
    // An AI pick for someone not in the round is ignored.
    expect(judgeRound("AI", 40, undefined, "Z", ["A", "B"]).winnerParticipantId).toBeNull();
  });
  it("ranks the battle by rounds, then vote share", () => {
    const o = battleOutcome(
      [
        { winnerParticipantId: "A", tally: tally({ A: 3, B: 1, C: 0 }) },
        { winnerParticipantId: "B", tally: tally({ A: 1, B: 5, C: 0 }) },
        { winnerParticipantId: "C", tally: tally({ A: 0, B: 0, C: 1 }) },
      ],
      ["A", "B", "C"],
    );
    expect(o.winnerParticipantId).toBe("B");
    expect(o.leaders).toEqual(["B"]);
  });
});

describe("entry order and durations", () => {
  it("shuffles N entries deterministically per round", () => {
    const sides = [0, 1, 2, 3, 4];
    expect(entryOrder("r1", true, sides)).toEqual(entryOrder("r1", true, sides));
    expect([...entryOrder("r1", true, sides)].sort()).toEqual(sides);
    expect(entryOrder("r1", false, [2, 0, 1])).toEqual([0, 1, 2]);
    const firsts = new Set(Array.from({ length: 40 }, (_, i) => entryOrder(`round-${i}`, true, sides)[0]));
    expect(firsts.size).toBeGreaterThan(2);
  });
  it("splits a battle length across rounds", () => {
    expect(windowsForDuration(24 * 60, 3)).toEqual({ submissionWindowMinutes: 240, votingWindowMinutes: 240 });
    expect(windowsForDuration(60, 10)).toEqual({ submissionWindowMinutes: 5, votingWindowMinutes: 5 });
    expect(DURATION_PRESETS.map((d) => d.key)).toContain("24h");
  });
});
