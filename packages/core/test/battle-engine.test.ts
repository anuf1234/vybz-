import { describe, expect, it } from "vitest";
import {
  BattleRuleError,
  BattleSetupSchema,
  type BattleState,
  CHALLENGE_TTL_MS,
  LINEUP_WINDOW_MS,
  accept,
  advance,
  assertRoundVotable,
  cancel,
  creditListen,
  eraLabel,
  fitsEra,
  lineupSize,
  lockLineup,
  newDraft,
  nextDeadline,
  requiredListenMs,
  revealedRounds,
  send,
  tally,
} from "../src";

const MIN = 60_000;
const H = 60 * MIN;
const t0 = new Date("2026-10-16T00:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

function draft(over: Partial<BattleState> = {}): BattleState {
  return { ...newDraft({ type: "SONG_FOR_SONG", roundCount: 5, votingDurationMs: 24 * H, revealIntervalMs: 0, scheduledFor: null }), ...over };
}

/** Challenger locks and sends at t0, opponent accepts at +1h and locks at +2h. */
function live(over: Partial<BattleState> = {}): BattleState {
  let s = send(lockLineup(draft(over), 0, t0), t0);
  s = accept(s, at(1 * H));
  return lockLineup(s, 1, at(2 * H));
}

describe("battle lifecycle", () => {
  it("goes DRAFT → CHALLENGE_SENT → ACCEPTED → SCHEDULED → ACTIVE → VOTING → COMPLETED", () => {
    let s = draft();
    expect(() => send(s, t0)).toThrow(BattleRuleError); // no picks yet
    s = lockLineup(s, 0, t0);
    s = send(s, t0);
    expect(s).toMatchObject({ status: "CHALLENGE_SENT", expiresAt: at(CHALLENGE_TTL_MS) });
    s = accept(s, at(H));
    expect(s).toMatchObject({ status: "ACCEPTED", lineupDueAt: at(H + LINEUP_WINDOW_MS) });
    s = lockLineup(s, 1, at(2 * H));
    expect(s).toMatchObject({ status: "SCHEDULED", startsAt: at(2 * H), votingEndsAt: at(26 * H) });

    const { state, transitions } = advance(s, at(30 * H));
    expect(transitions.map((t) => `${t.from}→${t.to}@${(t.at.getTime() - t0.getTime()) / H}h`)).toEqual([
      "SCHEDULED→ACTIVE@2h",
      "ACTIVE→VOTING@2h",
      "VOTING→COMPLETED@26h",
    ]);
    expect(state).toMatchObject({ status: "COMPLETED", completedAt: at(26 * H) });
    expect(nextDeadline(state)).toBeNull();
  });

  it("waits for a scheduled premiere", () => {
    const s = live({ scheduledFor: at(10 * H) });
    expect(s).toMatchObject({ status: "SCHEDULED", startsAt: at(10 * H) });
    expect(advance(s, at(9 * H)).state.status).toBe("SCHEDULED");
    expect(advance(s, at(10 * H)).state.status).toBe("VOTING");
  });

  it("reveals rounds one at a time and votes only on unlocked rounds", () => {
    const s = live({ revealIntervalMs: 10 * MIN }); // starts at +2h, 5 rounds
    const at1 = advance(s, at(2 * H + 15 * MIN)).state;
    expect(at1.status).toBe("ACTIVE");
    expect(revealedRounds(at1, at(2 * H + 15 * MIN))).toBe(2);
    expect(() => assertRoundVotable(at1, 1, at(2 * H + 15 * MIN))).not.toThrow();
    expect(() => assertRoundVotable(at1, 2, at(2 * H + 15 * MIN))).toThrow(BattleRuleError);

    const allIn = advance(s, at(2 * H + 40 * MIN)).state;
    expect(allIn.status).toBe("VOTING");
    // Voting window starts once the last round is revealed.
    expect(allIn.votingEndsAt).toEqual(at(2 * H + 40 * MIN + 24 * H));
  });

  it("closes voting at the deadline", () => {
    const s = advance(live(), at(3 * H)).state;
    expect(() => assertRoundVotable(s, 0, at(25 * H))).not.toThrow();
    const done = advance(s, at(26 * H)).state;
    expect(() => assertRoundVotable(done, 0, at(26 * H))).toThrow(BattleRuleError);
  });

  it("expires unanswered challenges and missed lineups", () => {
    const sent = send(lockLineup(draft(), 0, t0), t0);
    expect(advance(sent, at(CHALLENGE_TTL_MS)).state).toMatchObject({ status: "CANCELLED", cancelReason: "EXPIRED" });
    expect(() => accept(sent, at(CHALLENGE_TTL_MS + 1))).toThrow(BattleRuleError);

    const accepted = accept(sent, at(H));
    const late = advance(accepted, at(H + LINEUP_WINDOW_MS)).state;
    expect(late).toMatchObject({ status: "CANCELLED", cancelReason: "LINEUP_MISSED" });
    expect(() => lockLineup(accepted, 1, at(H + LINEUP_WINDOW_MS))).toThrow(BattleRuleError);
  });

  it("only lets each side lock once, in its own phase", () => {
    const s = lockLineup(draft(), 0, t0);
    expect(() => lockLineup(s, 0, t0)).toThrow(BattleRuleError);
    expect(() => lockLineup(s, 1, t0)).toThrow(BattleRuleError);
  });

  it("can be called off before it goes live, and only moderated after", () => {
    const sent = send(lockLineup(draft(), 0, t0), t0);
    expect(cancel(sent, "DECLINED", at(1))).toMatchObject({ status: "CANCELLED", cancelReason: "DECLINED" });
    const running = live();
    expect(() => cancel(running, "WITHDRAWN", at(3 * H))).toThrow(BattleRuleError);
    expect(cancel(running, "MODERATED", at(3 * H)).status).toBe("CANCELLED");
  });
});

describe("tally", () => {
  const r = (index: number, a: number, b: number) => ({ index, votes: [a, b] as [number, number], submissionIds: [`a${index}`, `b${index}`] as [string, string] });

  it("scores rounds and names the crowd favorite", () => {
    const res = tally([r(0, 5, 3), r(1, 2, 9), r(2, 4, 4), r(3, 7, 1)]);
    expect(res.score).toEqual([2, 1]);
    expect(res.rounds.map((x) => x.winnerSide)).toEqual([0, 1, null, 0]);
    expect(res.winnerSide).toBe(0);
    expect(res.crowdFavorite).toEqual({ submissionId: "b1", votes: 9 });
  });

  it("breaks level rounds on total votes, then calls a draw", () => {
    expect(tally([r(0, 5, 3), r(1, 2, 9)]).winnerSide).toBe(1);
    expect(tally([r(0, 5, 3), r(1, 3, 5)]).winnerSide).toBeNull();
    expect(tally([r(0, 0, 0)])).toMatchObject({ winnerSide: null, crowdFavorite: null });
  });
});

describe("listening credit", () => {
  it("needs 10 seconds, or a short clip to its end", () => {
    expect(requiredListenMs(30_000)).toBe(10_000);
    expect(requiredListenMs(6_000)).toBe(5_000);
    expect(requiredListenMs(null)).toBe(10_000);
  });

  it("caps credit by time since this pick started", () => {
    const c = creditListen({ previousMs: 0, reportedMs: 30_000, startedAt: t0, otherCreditMs: 0, battleStartedAt: t0, now: at(3_000) });
    expect(c).toBe(5_000);
  });

  it("gives nothing extra for playing several picks at once", () => {
    // 12s into the battle, 11s already credited on the other side: only ~3s left to give.
    const c = creditListen({ previousMs: 0, reportedMs: 12_000, startedAt: t0, otherCreditMs: 11_000, battleStartedAt: t0, now: at(12_000) });
    expect(c).toBe(3_000);
  });

  it("never lowers credit", () => {
    expect(creditListen({ previousMs: 8_000, reportedMs: 0, startedAt: t0, otherCreditMs: 0, battleStartedAt: t0, now: at(9_000) })).toBe(8_000);
  });
});

describe("setup", () => {
  const base = {
    type: "SONG_FOR_SONG" as const,
    mode: "OPEN" as const,
    title: "2000s R&B Battle",
    theme: "2000s R&B",
    genre: "R&B" as const,
    tagline: null,
    roundCount: 10,
    playlistLength: null,
    visibility: "PUBLIC" as const,
    votingDurationMs: 24 * H,
    revealIntervalMs: 0,
    hideTotals: true,
    eraFrom: 2000,
    eraTo: 2009,
    scheduledFor: null,
  };

  it("accepts a song battle and sizes the lineup", () => {
    const s = BattleSetupSchema.parse(base);
    expect(lineupSize(s)).toBe(10);
    expect(eraLabel(s)).toBe("2000–2009");
    expect(fitsEra(s, 2004)).toBe(true);
    expect(fitsEra(s, 2012)).toBe(false);
  });

  it("makes playlist and mix battles a single round", () => {
    expect(BattleSetupSchema.safeParse({ ...base, type: "PLAYLIST", roundCount: 1, playlistLength: 5 }).success).toBe(true);
    expect(lineupSize({ type: "PLAYLIST", roundCount: 1, playlistLength: 5 })).toBe(5);
    expect(BattleSetupSchema.safeParse({ ...base, type: "PLAYLIST", roundCount: 10, playlistLength: 5 }).success).toBe(false);
    expect(BattleSetupSchema.safeParse({ ...base, type: "DJ_MIX", roundCount: 1 }).success).toBe(true);
  });

  it("rejects live DJ battles, odd round counts, bad durations and markup-ish whitespace", () => {
    expect(BattleSetupSchema.safeParse({ ...base, type: "LIVE_DJ", roundCount: 1 }).success).toBe(false);
    expect(BattleSetupSchema.safeParse({ ...base, roundCount: 4 }).success).toBe(false);
    expect(BattleSetupSchema.safeParse({ ...base, votingDurationMs: 123 }).success).toBe(false);
    expect(BattleSetupSchema.parse({ ...base, title: "  Big\n\tbattle  " }).title).toBe("Big battle");
  });
});
