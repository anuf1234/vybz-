import { describe, expect, it } from "vitest";
import { ROUND_TIMING, fastTiming } from "../src/rules";
import { judgeRound } from "../src/scoring";

describe("fast rounds", () => {
  it("caps picks at 3 minutes and fixes votes at 90 seconds", () => {
    expect(fastTiming({ submissionWindowMinutes: 1440, votingWindowMinutes: 1440 })).toEqual({ submissionWindowMinutes: 3, votingWindowMinutes: 1.5 });
    expect(fastTiming({ submissionWindowMinutes: 1, votingWindowMinutes: 5 })).toEqual({ submissionWindowMinutes: 1, votingWindowMinutes: ROUND_TIMING.voteMinutes });
  });

  it("lets the AI break a tied or empty crowd vote, and only then", () => {
    const ids = ["a", "b"];
    expect(judgeRound("CROWD", 0, undefined, "b", ids)).toEqual({ winnerParticipantId: "b", aiWinnerParticipantId: "b", crowdWinnerParticipantId: null });
    const tie = { a: { count: 2, weighted: 2 }, b: { count: 2, weighted: 2 } };
    expect(judgeRound("CROWD", 0, tie, "a", ids).winnerParticipantId).toBe("a");
    const clear = { a: { count: 1, weighted: 1 }, b: { count: 3, weighted: 3 } };
    expect(judgeRound("CROWD", 0, clear, "a", ids)).toEqual({ winnerParticipantId: "b", aiWinnerParticipantId: null, crowdWinnerParticipantId: "b" });
    // No AI: a tie stays a draw.
    expect(judgeRound("CROWD", 0, tie, null, ids).winnerParticipantId).toBeNull();
  });
});
