import { describe, expect, it } from "vitest";
import {
  type BattleAggregate,
  EngineError,
  acceptBattle,
  advance,
  cancelBattle,
  createBattle,
  currentRound,
  declineBattle,
  nextDeadline,
  parseRules,
  standings,
  submitTrack,
} from "../src";

const T0 = new Date("2026-11-01T12:00:00Z");
const min = (n: number) => n * 60_000;

function ctxAt(now: Date) {
  let n = 0;
  return { now, newId: () => `id${++n}-${now.getTime()}` };
}

const at = (ms: number) => ctxAt(new Date(T0.getTime() + ms));

function started(rulesInput: Parameters<typeof parseRules>[0] = {}): BattleAggregate {
  const rules = parseRules({ roundCount: 3, timing: { submissionWindowMinutes: 10, votingWindowMinutes: 10 }, ...((rulesInput as object) ?? {}) });
  const { battle } = createBattle({ id: "b1", creatorId: "alice", rules }, at(0));
  return acceptBattle(battle, "bob", at(1)).battle;
}

function pid(b: BattleAggregate, user: string) {
  return b.participants.find((p) => p.userId === user)!.id;
}

/** Both sides submit for the current round and voting opens. */
function playRound(b: BattleAggregate, ms: number, trackSeed: string): BattleAggregate {
  const r = currentRound(b)!;
  b = submitTrack(b, { userId: "alice", roundIndex: r.index, tracks: [{ id: `a-${trackSeed}` }] }, at(ms)).battle;
  b = submitTrack(b, { userId: "bob", roundIndex: r.index, tracks: [{ id: `b-${trackSeed}` }] }, at(ms)).battle;
  return b;
}

function withVotes(b: BattleAggregate, aliceVotes: number, bobVotes: number): BattleAggregate {
  const r = currentRound(b)!;
  return {
    ...b,
    tallies: {
      ...b.tallies,
      [r.id]: {
        [pid(b, "alice")]: { weighted: aliceVotes, count: aliceVotes },
        [pid(b, "bob")]: { weighted: bobVotes, count: bobVotes },
      },
    },
  };
}

describe("challenge lifecycle", () => {
  it("creates an open challenge with pending rounds", () => {
    const { battle, events } = createBattle({ creatorId: "alice", rules: parseRules({ roundCount: 5 }) }, at(0));
    expect(battle.status).toBe("OPEN_CHALLENGE");
    expect(battle.rounds).toHaveLength(5);
    expect(battle.rounds.every((r) => r.status === "PENDING")).toBe(true);
    expect(battle.participants).toEqual([expect.objectContaining({ userId: "alice", side: 0 })]);
    expect(events[0]?.type).toBe("battle.created");
  });

  it("direct challenges can only be accepted by the invitee", () => {
    const { battle } = createBattle({ creatorId: "alice", invitedUserId: "bob", rules: parseRules({}) }, at(0));
    expect(battle.status).toBe("PENDING_ACCEPT");
    expect(() => acceptBattle(battle, "carol", at(1))).toThrow(EngineError);
    expect(acceptBattle(battle, "bob", at(1)).battle.status).toBe("IN_PROGRESS");
  });

  it("rejects challenging yourself and accepting your own battle", () => {
    expect(() => createBattle({ creatorId: "alice", invitedUserId: "alice", rules: parseRules({}) }, at(0))).toThrow("OWN_BATTLE");
    const { battle } = createBattle({ creatorId: "alice", rules: parseRules({}) }, at(0));
    expect(() => acceptBattle(battle, "alice", at(1))).toThrow("OWN_BATTLE");
  });

  it("accepting opens round 1 for submissions", () => {
    const b = started();
    expect(b.rounds[0]?.status).toBe("SUBMISSIONS_OPEN");
    expect(b.rounds[0]?.submissionsCloseAt?.getTime()).toBe(T0.getTime() + 1 + min(10));
    expect(nextDeadline(b)).toEqual(b.rounds[0]?.submissionsCloseAt);
  });

  it("expires unaccepted challenges", () => {
    const { battle } = createBattle({ creatorId: "alice", rules: parseRules({ challengeExpiryHours: 1 }) }, at(0));
    expect(advance(battle, at(min(59))).battle.status).toBe("OPEN_CHALLENGE");
    expect(advance(battle, at(min(60))).battle.status).toBe("EXPIRED");
    expect(() => acceptBattle(battle, "bob", at(min(61)))).toThrow(EngineError);
  });

  it("lets the creator cancel and the invitee decline before it starts", () => {
    const open = createBattle({ creatorId: "alice", rules: parseRules({}) }, at(0)).battle;
    expect(() => cancelBattle(open, "bob", at(1))).toThrow("NOT_CREATOR");
    expect(cancelBattle(open, "alice", at(1)).battle.status).toBe("CANCELLED");

    const direct = createBattle({ creatorId: "alice", invitedUserId: "bob", rules: parseRules({}) }, at(0)).battle;
    expect(declineBattle(direct, "bob").battle.status).toBe("CANCELLED");
    expect(() => cancelBattle(started(), "alice", at(2))).toThrow("NOT_OPEN");
  });

  it("does not mutate its input", () => {
    const { battle } = createBattle({ creatorId: "alice", rules: parseRules({}) }, at(0));
    const snapshot = structuredClone(battle);
    acceptBattle(battle, "bob", at(1));
    expect(battle).toEqual(snapshot);
  });
});

describe("submissions", () => {
  it("opens voting once both sides submit", () => {
    let b = started();
    b = submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t1" }] }, at(min(1))).battle;
    expect(b.rounds[0]?.status).toBe("SUBMISSIONS_OPEN");
    const res = submitTrack(b, { userId: "bob", roundIndex: 0, tracks: [{ id: "t2" }] }, at(min(2)));
    expect(res.battle.rounds[0]?.status).toBe("VOTING_OPEN");
    expect(res.battle.rounds[0]?.votingClosesAt?.getTime()).toBe(T0.getTime() + min(12));
    expect(res.events.map((e) => e.type)).toEqual(["round.submitted", "round.voting_opened"]);
  });

  it("rejects double submissions, reused tracks, outsiders and the wrong round", () => {
    let b = started();
    b = submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t1" }] }, at(1)).battle;
    expect(() => submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t9" }] }, at(2))).toThrow("ALREADY_SUBMITTED");
    expect(() => submitTrack(b, { userId: "bob", roundIndex: 0, tracks: [{ id: "t1" }] }, at(2))).toThrow("TRACK_ALREADY_USED");
    expect(() => submitTrack(b, { userId: "carol", roundIndex: 0, tracks: [{ id: "t3" }] }, at(2))).toThrow("NOT_PARTICIPANT");
    expect(() => submitTrack(b, { userId: "bob", roundIndex: 1, tracks: [{ id: "t3" }] }, at(2))).toThrow("ROUND_NOT_CURRENT");
  });

  it("enforces the era rule", () => {
    const b = started({ constraints: { eraFrom: 2000, eraTo: 2009 } });
    expect(() => submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t", releaseYear: 1999 }] }, at(1))).toThrow(expect.objectContaining({ code: "TRACK_OUTSIDE_ERA" }));
    expect(() => submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t" }] }, at(1))).toThrow(expect.objectContaining({ code: "TRACK_YEAR_UNKNOWN" }));
    expect(submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t", releaseYear: 2004 }] }, at(1)).battle.submissions).toHaveLength(1);
  });

  it("refuses submissions after the deadline even before advance runs", () => {
    const b = started();
    expect(() => submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t" }] }, at(min(11)))).toThrow("ROUND_NOT_ACCEPTING_SUBMISSIONS");
  });
});

describe("deadlines and scoring", () => {
  it("awards a round to the only side that submitted", () => {
    let b = started();
    b = submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t1" }] }, at(1)).battle;
    const res = advance(b, at(min(11)));
    expect(res.battle.rounds[0]).toMatchObject({ status: "SCORED", winnerParticipantId: pid(b, "alice"), forfeitParticipantIds: [pid(b, "bob")] });
    expect(res.battle.rounds[1]?.status).toBe("SUBMISSIONS_OPEN");
  });

  it("scores a round as a draw when nobody submits", () => {
    const res = advance(started(), at(min(11)));
    expect(res.battle.rounds[0]).toMatchObject({ status: "SCORED", winnerParticipantId: null });
  });

  it("extends voting once when there are too few votes, then scores", () => {
    let b = playRound(started({ minVotesToCount: 3 }), min(1), "r0");
    let res = advance(b, at(min(11)));
    expect(res.battle.rounds[0]?.status).toBe("VOTING_OPEN");
    expect(res.events.map((e) => e.type)).toEqual(["round.voting_extended"]);
    b = withVotes(res.battle, 1, 0);
    res = advance(b, at(min(22)));
    expect(res.battle.rounds[0]).toMatchObject({ status: "SCORED", winnerParticipantId: pid(b, "alice") });
  });

  it("plays a full battle to a winner", () => {
    let b = started();
    let t = min(1);
    for (const [a, c] of [
      [3, 1],
      [0, 2],
      [5, 4],
    ] as const) {
      b = withVotes(playRound(b, t, String(t)), a, c);
      t += min(11);
      b = advance(b, at(t)).battle;
    }
    expect(b.status).toBe("COMPLETE");
    expect(b.winnerParticipantId).toBe(pid(b, "alice"));
    expect(standings(b).roundsWon).toEqual({ [pid(b, "alice")]: 2, [pid(b, "bob")]: 1 });
    expect(nextDeadline(b)).toBeNull();
  });

  it("breaks a level battle on total vote share before sudden death", () => {
    let b = started({ roundCount: 3 });
    let t = min(1);
    for (const [a, c] of [
      [10, 1],
      [2, 3],
      [1, 1],
    ] as const) {
      b = withVotes(playRound(b, t, String(t)), a, c);
      t += min(11);
      b = advance(b, at(t)).battle;
    }
    expect(b.status).toBe("COMPLETE");
    expect(b.winnerParticipantId).toBe(pid(b, "alice"));
  });

  it("adds one sudden-death round when completely level, then can end in a draw", () => {
    let b = started({ roundCount: 3, minVotesToCount: 0 });
    let t = min(1);
    for (const [a, c] of [
      [2, 1],
      [1, 2],
      [0, 0],
    ] as const) {
      b = withVotes(playRound(b, t, String(t)), a, c);
      t += min(11);
      b = advance(b, at(t)).battle;
    }
    expect(b.status).toBe("IN_PROGRESS");
    expect(b.rounds).toHaveLength(4);
    expect(b.rounds[3]).toMatchObject({ suddenDeath: true, status: "SUBMISSIONS_OPEN" });

    // Nobody submits in sudden death: the battle ends level.
    b = advance(b, at(t + min(11))).battle;
    expect(b.status).toBe("COMPLETE");
    expect(b.winnerParticipantId).toBeNull();
  });

  it("catches up across several missed deadlines in one call", () => {
    const b = started({ roundCount: 3, suddenDeath: false });
    let res = advance(b, at(min(11)));
    res = advance(res.battle, at(min(11) + min(11)));
    res = advance(res.battle, at(min(11) * 3 + min(11)));
    expect(res.battle.status).toBe("COMPLETE");
  });

  it("is idempotent", () => {
    const b = advance(started(), at(min(11))).battle;
    const again = advance(b, at(min(11)));
    expect(again.events).toEqual([]);
    expect(again.battle).toEqual(b);
  });
});
