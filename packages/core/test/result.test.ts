import { describe, expect, it } from "vitest";
import { battleResultSummary } from "../src/result";

const user = (handle: string) => ({ id: `u-${handle}`, handle, displayName: handle, image: null });
const p = (id: string, side: number, handle: string, roundsWon: number) => ({ id, side, user: user(handle), roundsWon });

const duel = {
  title: "Throwback night",
  theme: "2000s R&B",
  format: "DUEL" as const,
  participants: [p("a", 0, "ana", 3), p("b", 1, "maya", 1)],
  winnerParticipantId: "a",
  rules: { constraints: undefined },
};

describe("battleResultSummary", () => {
  it("brags for the winner and challenges for them", () => {
    const s = battleResultSummary(duel as never, "ana");
    expect(s).toMatchObject({ outcome: "WIN", headline: "I beat @maya 3–1 in a 2000s R&B battle.", callToAction: "Think you can beat me?", score: "3–1", challengeHandle: "ana" });
  });

  it("owns the loss and still invites a challenge", () => {
    const s = battleResultSummary(duel as never, "@Maya");
    expect(s).toMatchObject({ outcome: "LOSS", headline: "@ana edged me 3–1 in a 2000s R&B battle.", challengeHandle: "maya" });
  });

  it("reads neutrally for spectators and points the challenge at the winner", () => {
    const s = battleResultSummary(duel as never, null);
    expect(s).toMatchObject({ outcome: "SPECTATOR", headline: "@ana beat @maya 3–1 in a 2000s R&B battle.", callToAction: "Think you can beat @ana?", challengeHandle: "ana" });
  });

  it("handles draws, articles and themes from the rules", () => {
    const draw = { ...duel, theme: null, rules: { constraints: { eraFrom: 1980, eraTo: 1989 } }, participants: [p("a", 0, "ana", 2), p("b", 1, "maya", 2)], winnerParticipantId: null };
    expect(battleResultSummary(draw as never, "ana").headline).toBe("@maya and I went 2–2 in an 80s battle.");
    expect(battleResultSummary({ ...duel, theme: "R&B battle" } as never, "ana").headline).toBe("I beat @maya 3–1 in an R&B battle.");
  });

  it("gives places in group battles", () => {
    const multi = { ...duel, format: "MULTI" as const, participants: [p("a", 0, "ana", 3), p("b", 1, "maya", 4), p("c", 2, "kev", 1)], winnerParticipantId: "b" };
    expect(battleResultSummary(multi as never, "ana")).toMatchObject({ outcome: "LOSS", headline: "I finished 2nd of 3 in a 3-player 2000s R&B battle.", place: 2 });
    expect(battleResultSummary(multi as never, "maya").headline).toBe("I won a 3-player 2000s R&B battle.");
    expect(battleResultSummary(multi as never).headline).toBe("@maya won a 3-player 2000s R&B battle.");
  });
});
