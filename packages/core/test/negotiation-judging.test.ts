import { describe, expect, it } from "vitest";
import {
  type BattleAggregate,
  acceptBattle,
  advance,
  aiScorecard,
  awaitingResponseFrom,
  checkTrackAllowed,
  checkVote,
  counterOffer,
  createBattle,
  currentRound,
  judgeRound,
  parseRules,
  submitTrack,
  themeLabel,
  trackMatchesGenres,
} from "../src";

const T0 = new Date("2026-11-01T12:00:00Z");
let n = 0;
const at = (ms: number) => ({ now: new Date(T0.getTime() + ms), newId: () => `id${++n}` });
const MIN = 60_000;

describe("terms negotiation", () => {
  const base = () => createBattle({ creatorId: "alice", invitedUserId: "bob", rules: parseRules({ roundCount: 5 }) }, at(0)).battle;

  it("lets the invitee counter and then requires the creator to answer", () => {
    let b = base();
    expect(awaitingResponseFrom(b)).toBe("bob");
    expect(() => counterOffer(b, "alice", parseRules({ roundCount: 3 }), at(1))).toThrow(expect.objectContaining({ code: "NOT_YOUR_TURN" }));

    b = counterOffer(b, "bob", parseRules({ roundCount: 3, tracksPerRound: 2 }), at(1)).battle;
    expect(b).toMatchObject({ status: "PENDING_ACCEPT", proposedByUserId: "bob", counterCount: 1 });
    expect(b.rounds).toHaveLength(3);
    expect(b.previousRules?.roundCount).toBe(5);
    expect(awaitingResponseFrom(b)).toBe("alice");
    expect(() => acceptBattle(b, "bob", at(2))).toThrow(expect.objectContaining({ code: "NOT_YOUR_TURN" }));

    // Alice counters back with 7 rounds, Bob accepts.
    b = counterOffer(b, "alice", parseRules({ roundCount: 7, tracksPerRound: 2 }), at(3)).battle;
    expect(b.rounds).toHaveLength(7);
    const started = acceptBattle(b, "bob", at(4)).battle;
    expect(started.status).toBe("IN_PROGRESS");
    expect(started.participants.map((p) => p.userId)).toEqual(["alice", "bob"]);
    expect(started.rules).toMatchObject({ roundCount: 7, tracksPerRound: 2 });
  });

  it("turns a counter on an open challenge into a direct negotiation", () => {
    let b = createBattle({ creatorId: "alice", rules: parseRules({}) }, at(0)).battle;
    b = counterOffer(b, "carol", parseRules({ constraints: { genres: ["rnb"], eraFrom: 1990, eraTo: 1999 } }), at(1)).battle;
    expect(b).toMatchObject({ status: "PENDING_ACCEPT", invitedUserId: "carol" });
    expect(() => acceptBattle(b, "dave", at(2))).toThrow(expect.objectContaining({ code: "NOT_INVITED" }));
    const s = acceptBattle(b, "alice", at(2)).battle;
    expect(s.participants.map((p) => p.userId)).toEqual(["alice", "carol"]);
  });

  it("rejects no-op counters and endless haggling", () => {
    let b = base();
    expect(() => counterOffer(b, "bob", b.rules, at(1))).toThrow(expect.objectContaining({ code: "NO_CHANGES" }));
    for (let i = 0; i < 10; i++) {
      const who = i % 2 === 0 ? "bob" : "alice";
      b = counterOffer(b, who, parseRules({ roundCount: i % 2 === 0 ? 3 : 5, minVotesToCount: i + 1 }), at(i + 1)).battle;
    }
    expect(() => counterOffer(b, "bob", parseRules({ roundCount: 10 }), at(20))).toThrow(expect.objectContaining({ code: "TOO_MANY_COUNTERS" }));
  });
});

describe("tracks per round", () => {
  function started(tracksPerRound: number): BattleAggregate {
    const b = createBattle({ creatorId: "alice", rules: parseRules({ roundCount: 3, tracksPerRound }) }, at(0)).battle;
    return acceptBattle(b, "bob", at(1)).battle;
  }

  it("requires exactly the agreed number of tracks, all distinct", () => {
    const b = started(2);
    expect(() => submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t1" }] }, at(2))).toThrow(expect.objectContaining({ code: "WRONG_TRACK_COUNT" }));
    expect(() => submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t1" }, { id: "t1" }] }, at(2))).toThrow(expect.objectContaining({ code: "DUPLICATE_TRACK" }));
    let s = submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t1" }, { id: "t2" }] }, at(2)).battle;
    expect(s.submissions.map((x) => x.position)).toEqual([0, 1]);
    expect(currentRound(s)?.status).toBe("SUBMISSIONS_OPEN");
    expect(() => submitTrack(s, { userId: "bob", roundIndex: 0, tracks: [{ id: "t3" }, { id: "t2" }] }, at(3))).toThrow(expect.objectContaining({ code: "TRACK_ALREADY_USED" }));
    s = submitTrack(s, { userId: "bob", roundIndex: 0, tracks: [{ id: "t3" }, { id: "t4" }] }, at(3)).battle;
    expect(currentRound(s)?.status).toBe("VOTING_OPEN");
  });

  it("gates votes on listening to every track of both sets", () => {
    let b = started(2);
    b = submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t1" }, { id: "t2" }], submissionIds: ["a1", "a2"] }, at(2)).battle;
    b = submitTrack(b, { userId: "bob", roundIndex: 0, tracks: [{ id: "t3" }, { id: "t4" }], submissionIds: ["b1", "b2"] }, at(2)).battle;
    const voter = { userId: "carol", emailVerified: true, createdAt: new Date(0), status: "ACTIVE" as const };
    const heard = (ids: string[]) => ids.map((submissionId) => ({ submissionId, playedMs: 30_000, tier: "EMBED" as const }));
    const q = { battle: b, roundIndex: 0, voter, alreadyVoted: false, submissions: [], now: at(5).now };
    expect(checkVote({ ...q, proofs: heard(["a1", "b1", "b2"]) })).toBe("LISTEN_REQUIRED");
    expect(checkVote({ ...q, proofs: heard(["a1", "a2", "b1", "b2"]), submissionId: "a1" })).toBeNull();
  });
});

describe("genre and era rules", () => {
  it("matches provider genre names through aliases", () => {
    expect(trackMatchesGenres(["R&B/Soul", "Music"], ["rnb"])).toBe(true);
    expect(trackMatchesGenres(["Hip-Hop/Rap"], ["rnb"])).toBe(false);
    expect(trackMatchesGenres(["Hip-Hop/Rap"], ["rnb", "hiphop"])).toBe(true);
    expect(trackMatchesGenres([], ["rnb"])).toBeNull();
    expect(trackMatchesGenres(["Music"], ["rnb"])).toBeNull();
  });

  it("rejects known mismatches and allows unknown genres", () => {
    const rules = parseRules({ constraints: { genres: ["rnb"], eraFrom: 1990, eraTo: 1999 } });
    expect(() => checkTrackAllowed(rules, { id: "x", releaseYear: 1996, genres: ["Rock"] })).toThrow(expect.objectContaining({ code: "TRACK_OUTSIDE_GENRE" }));
    expect(() => checkTrackAllowed(rules, { id: "x", releaseYear: 2004, genres: ["R&B/Soul"] })).toThrow(expect.objectContaining({ code: "TRACK_OUTSIDE_ERA" }));
    expect(() => checkTrackAllowed(rules, { id: "x", releaseYear: 1996, genres: ["R&B/Soul"] })).not.toThrow();
    expect(() => checkTrackAllowed(rules, { id: "x", releaseYear: 1996 })).not.toThrow();
  });

  it("labels themes", () => {
    expect(themeLabel({ eraFrom: 1990, eraTo: 1999, genres: ["rnb"] })).toBe("90s R&B");
    expect(themeLabel({ eraFrom: 2000, eraTo: 2009 })).toBe("2000s");
    expect(themeLabel({ genres: ["hiphop", "rnb"] })).toBe("Hip-Hop / R&B");
    expect(themeLabel({ eraFrom: 1995, eraTo: 2003 })).toBe("1995–2003");
    expect(themeLabel(undefined)).toBeNull();
  });
});

describe("judging modes", () => {
  const ids = ["A", "B"] as const;
  const tally = (a: number, b: number) => ({ A: { weighted: a, count: a }, B: { weighted: b, count: b } });

  it("crowd, AI and separate scorecards", () => {
    expect(judgeRound("CROWD", 30, tally(3, 1), "B", ids)).toEqual({ winnerParticipantId: "A", aiWinnerParticipantId: null, crowdWinnerParticipantId: "A" });
    expect(judgeRound("AI", 30, tally(3, 1), "B", ids)).toMatchObject({ winnerParticipantId: "B", aiWinnerParticipantId: "B" });
    expect(judgeRound("SEPARATE", 30, tally(3, 1), "B", ids)).toEqual({ winnerParticipantId: "A", aiWinnerParticipantId: "B", crowdWinnerParticipantId: "A" });
  });

  it("combines crowd share and the AI's pick by weight", () => {
    // Crowd 60/40 for A, AI picks B at 30%: A = 0.42, B = 0.58 → B.
    expect(judgeRound("COMBINED", 30, tally(6, 4), "B", ids).winnerParticipantId).toBe("B");
    // Crowd 80/20 for A outweighs the AI at 30%: A = 0.56, B = 0.44.
    expect(judgeRound("COMBINED", 30, tally(8, 2), "B", ids).winnerParticipantId).toBe("A");
    // No crowd votes: the AI decides. No AI verdict: the crowd decides.
    expect(judgeRound("COMBINED", 30, undefined, "B", ids).winnerParticipantId).toBe("B");
    expect(judgeRound("COMBINED", 30, tally(2, 1), null, ids).winnerParticipantId).toBe("A");
  });

  function votingBattle(mode: "AI" | "SEPARATE"): BattleAggregate {
    let b = createBattle({ creatorId: "alice", rules: parseRules({ roundCount: 3, judging: { mode }, timing: { submissionWindowMinutes: 10, votingWindowMinutes: 10 } }) }, at(0)).battle;
    b = acceptBattle(b, "bob", at(1)).battle;
    b = submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t1" }] }, at(2)).battle;
    return submitTrack(b, { userId: "bob", roundIndex: 0, tracks: [{ id: "t2" }] }, at(2)).battle;
  }

  it("in AI-only battles the crowd can't vote and a missing verdict extends the round", () => {
    const b = votingBattle("AI");
    const voter = { userId: "carol", emailVerified: true, createdAt: new Date(0), status: "ACTIVE" as const };
    expect(checkVote({ battle: b, roundIndex: 0, voter, alreadyVoted: false, proofs: [], submissions: [], now: at(3).now })).toBe("AI_JUDGED");

    const r0 = currentRound(b)!;
    expect(advance(b, at(11 * MIN)).battle.rounds[0]!.status).toBe("VOTING_OPEN"); // extended, no verdict yet
    const bob = b.participants.find((p) => p.userId === "bob")!.id;
    const scored = advance({ ...b, aiVerdicts: { [r0.id]: bob } }, at(11 * MIN)).battle;
    expect(scored.rounds[0]).toMatchObject({ status: "SCORED", winnerParticipantId: bob, aiWinnerParticipantId: bob });
  });

  it("keeps a separate AI scorecard", () => {
    const b = votingBattle("SEPARATE");
    const r0 = currentRound(b)!;
    const [alice, bob] = b.participants.map((p) => p.id) as [string, string];
    const scored = advance({ ...b, tallies: { [r0.id]: { [alice]: { weighted: 2, count: 2 } } }, aiVerdicts: { [r0.id]: bob } }, at(11 * MIN)).battle;
    expect(scored.rounds[0]).toMatchObject({ winnerParticipantId: alice, aiWinnerParticipantId: bob });
    expect(aiScorecard(scored)).toEqual({ [alice]: 0, [bob]: 1 });
  });
});
