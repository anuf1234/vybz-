import { describe, expect, it } from "vitest";
import {
  type BattleAggregate,
  LISTEN_SLACK_MS,
  acceptBattle,
  can,
  checkVote,
  createBattle,
  entryOrder,
  parseRules,
  plausiblePlayedMs,
  requiredListenMs,
  submitTrack,
  HandleSchema,
  suggestHandle,
  BattleRulesSchema,
} from "../src";

const now = new Date("2026-11-01T12:00:00Z");
let n = 0;
const ctx = { now, newId: () => `id${++n}` };

function votingBattle(rules = {}): BattleAggregate {
  let b = createBattle({ creatorId: "alice", rules: parseRules({ roundCount: 3, fairListen: { minPlayedMs: 20_000 }, ...rules }) }, ctx).battle;
  b = acceptBattle(b, "bob", ctx).battle;
  b = submitTrack(b, { userId: "alice", roundIndex: 0, tracks: [{ id: "t1" }], submissionIds: ["s1"] }, ctx).battle;
  b = submitTrack(b, { userId: "bob", roundIndex: 0, tracks: [{ id: "t2" }], submissionIds: ["s2"] }, ctx).battle;
  return b;
}

const voter = { userId: "carol", emailVerified: true, createdAt: new Date("2026-01-01"), status: "ACTIVE" as const };
const fullProofs = [
  { submissionId: "s1", playedMs: 20_000, tier: "EMBED" as const },
  { submissionId: "s2", playedMs: 25_000, tier: "EMBED" as const },
];
const base = (b: BattleAggregate) => ({ battle: b, roundIndex: 0, voter, alreadyVoted: false, proofs: fullProofs, submissions: [], now });

describe("checkVote", () => {
  it("allows an eligible voter who listened to both", () => {
    expect(checkVote({ ...base(votingBattle()), submissionId: "s1" })).toBeNull();
  });

  it("blocks guests, participants, unverified, restricted and repeat voters", () => {
    const b = votingBattle();
    expect(checkVote({ ...base(b), voter: null })).toBe("SIGN_IN_REQUIRED");
    expect(checkVote({ ...base(b), voter: { ...voter, userId: "alice" } })).toBe("PARTICIPANT");
    expect(checkVote({ ...base(b), voter: { ...voter, emailVerified: false } })).toBe("EMAIL_NOT_VERIFIED");
    expect(checkVote({ ...base(b), voter: { ...voter, status: "SUSPENDED" } })).toBe("ACCOUNT_RESTRICTED");
    expect(checkVote({ ...base(b), alreadyVoted: true })).toBe("ALREADY_VOTED");
  });

  it("tolerates clock skew when there is no account-age rule", () => {
    expect(checkVote({ ...base(votingBattle()), voter: { ...voter, createdAt: new Date(now.getTime() + 60_000) } })).toBeNull();
  });

  it("respects per-battle account age and verification rules", () => {
    const b = votingBattle({ voterEligibility: { minAccountAgeHours: 24, requireVerifiedEmail: false } });
    expect(checkVote({ ...base(b), voter: { ...voter, emailVerified: false } })).toBeNull();
    expect(checkVote({ ...base(b), voter: { ...voter, createdAt: new Date(now.getTime() - 3_600_000) } })).toBe("ACCOUNT_TOO_NEW");
  });

  it("requires listening to both sides, long enough, at the same tier", () => {
    const b = votingBattle();
    expect(checkVote({ ...base(b), proofs: [fullProofs[0]!] })).toBe("LISTEN_REQUIRED");
    expect(checkVote({ ...base(b), proofs: [fullProofs[0]!, { ...fullProofs[1]!, playedMs: 5_000 }] })).toBe("LISTEN_REQUIRED");
    expect(checkVote({ ...base(b), proofs: [fullProofs[0]!, { ...fullProofs[1]!, tier: "PREVIEW" }] })).toBe("TIER_MISMATCH");
  });

  it("caps the listen requirement at the track length", () => {
    const b = votingBattle();
    const short = [
      { submissionId: "s1", playedMs: 10_000, tier: "EMBED" as const },
      { submissionId: "s2", playedMs: 20_000, tier: "EMBED" as const },
    ];
    expect(checkVote({ ...base(b), proofs: short, submissions: [{ submissionId: "s1", durationMs: 11_000 }] })).toBeNull();
  });

  it("rejects votes for submissions outside the round and when voting is closed", () => {
    const b = votingBattle();
    expect(checkVote({ ...base(b), submissionId: "nope" })).toBe("UNKNOWN_SUBMISSION");
    expect(checkVote({ ...base(b), roundIndex: 1 })).toBe("VOTING_CLOSED");
    expect(checkVote({ ...base(b), now: new Date(now.getTime() + 2 * 86_400_000) })).toBe("VOTING_CLOSED");
  });
});

describe("listen accounting", () => {
  it("never credits more than wall-clock time, and never goes backwards", () => {
    const start = new Date(now.getTime() - 10_000);
    expect(plausiblePlayedMs(start, now, 0, 60_000)).toBe(10_000 + LISTEN_SLACK_MS);
    expect(plausiblePlayedMs(start, now, 8_000, 3_000)).toBe(8_000);
    expect(plausiblePlayedMs(start, now, 0, -5)).toBe(0);
  });

  it("requires less for previews and short tracks", () => {
    expect(requiredListenMs(45_000, null, "PREVIEW")).toBe(30_000 - LISTEN_SLACK_MS);
    expect(requiredListenMs(20_000, 8_000, "EMBED")).toBe(8_000 - LISTEN_SLACK_MS);
    expect(requiredListenMs(0, null, "EMBED")).toBe(0);
  });
});

describe("entryOrder", () => {
  it("is stable per round and not always side 0 first when blind", () => {
    expect(entryOrder("abc", true)).toEqual(entryOrder("abc", true));
    const firsts = new Set(Array.from({ length: 20 }, (_, i) => entryOrder(`round-${i}`, true)[0]));
    expect(firsts).toEqual(new Set([0, 1]));
    expect(entryOrder("abc", false)).toEqual([0, 1]);
  });
});

describe("policy", () => {
  const actor = { userId: "u", role: "USER" as const, status: "ACTIVE" as const, emailVerified: true };
  it("lets anyone view and only staff void", () => {
    expect(can(null, "battle.view").allow).toBe(true);
    expect(can(null, "battle.create")).toEqual({ allow: false, reason: "SIGN_IN_REQUIRED" });
    expect(can(actor, "battle.void").allow).toBe(false);
    expect(can({ ...actor, role: "MODERATOR" }, "battle.void").allow).toBe(true);
  });
  it("requires a verified email to battle when the deployment asks for it", () => {
    expect(can({ ...actor, emailVerified: false }, "battle.create", { requireVerifiedEmail: true })).toEqual({ allow: false, reason: "EMAIL_NOT_VERIFIED" });
    expect(can({ ...actor, emailVerified: false }, "battle.create").allow).toBe(true);
    expect(can({ ...actor, status: "BANNED" }, "battle.vote").allow).toBe(false);
  });
});

describe("rules and handles", () => {
  it("fills defaults and rejects unknown keys and bad values", () => {
    const r = parseRules({});
    expect(r).toMatchObject({ roundCount: 5, blindVoting: true, suddenDeath: true, fairListen: { minPlayedMs: 20_000 } });
    expect(BattleRulesSchema.safeParse({ roundCount: 4 }).success).toBe(false);
    expect(BattleRulesSchema.safeParse({ cheat: true }).success).toBe(false);
    expect(BattleRulesSchema.safeParse({ constraints: { eraFrom: 2010, eraTo: 2000 } }).success).toBe(false);
  });
  it("validates handles", () => {
    expect(HandleSchema.parse(" DJ_Baba ")).toBe("dj_baba");
    expect(HandleSchema.safeParse("ab").success).toBe(false);
    expect(HandleSchema.safeParse("admin").success).toBe(false);
    expect(suggestHandle("Baba.K@example.com")).toBe("babak");
    expect(suggestHandle("x@y.z")).toBe("listener");
  });
});
