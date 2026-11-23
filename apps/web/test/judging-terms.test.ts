import { type DbHandle, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AiJudge, AnthropicJudge, type JudgeInput, describeForJudge } from "../src/server/ai-judge";
import {
  type BattleDeps,
  type UserRow,
  acceptBattle,
  castVote,
  counterBattle,
  createBattle,
  ensureAiVerdicts,
  getBattleView,
  listBattles,
  recordListen,
  submitPick,
} from "../src/server/battles/service";
import { TEST_DB_URL, freshDb } from "./helpers";

const MIN = 60_000;

/** Records what the AI was shown and always picks `pick`. */
class FakeJudge implements AiJudge {
  readonly label = "Fake";
  inputs: JudgeInput[] = [];
  constructor(public pick: "A" | "B" = "A") {}
  async judge(input: JudgeInput) {
    this.inputs.push(input);
    return {
      winner: this.pick,
      confidence: 0.8,
      reason: `Side ${this.pick} fits the theme better.`,
      model: "fake-1",
      breakdown: [
        { criterion: "fit" as const, edge: this.pick, note: "Right on theme" },
        { criterion: "recognition" as const, edge: "EVEN" as const, note: "Both award winners" },
      ],
    };
  }
}

describe.skipIf(!TEST_DB_URL)("judging modes, negotiated terms and genre rules", () => {
  let h: DbHandle;
  let clock = Date.now();
  const tick = (ms: number) => (clock += ms);
  const judge = new FakeJudge();
  let deps: BattleDeps;
  const u: Record<string, UserRow> = {};
  const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });

  beforeAll(async () => {
    h = await freshDb();
    deps = {
      db: h.db,
      catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" },
      requireVerifiedEmail: false,
      aiJudge: judge,
      now: () => new Date(clock),
    };
    for (const handle of ["ann", "ben", "cat", "dan"]) {
      const [row] = await h.db
        .insert(schema.user)
        .values({ id: `u_${handle}`, name: handle, email: `${handle}@example.com`, handle, emailVerified: true })
        .returning();
      u[handle] = row!;
    }
  });
  afterAll(() => h?.close());

  const fast = { timing: { submissionWindowMinutes: 30, votingWindowMinutes: 30 }, fairListen: { minPlayedMs: 0 } };

  it("negotiates rounds, tracks per round, genre, era and judging before starting", async () => {
    const { id } = await createBattle(deps, u.ann!, { title: "Showdown", opponentHandle: "ben", rules: { roundCount: 5, ...fast } });

    // Ben counters: 3 rounds, 2 tracks each, 2000s R&B, crowd + AI combined.
    await counterBattle(deps, u.ben!, id, {
      rules: { roundCount: 3, tracksPerRound: 2, constraints: { genres: ["rnb"], eraFrom: 2000, eraTo: 2009 }, judging: { mode: "COMBINED", aiWeightPercent: 40 }, ...fast },
    });
    let v = await getBattleView(deps, u.ann!, id);
    expect(v.status).toBe("PENDING_ACCEPT");
    expect(v.theme).toBe("2000s R&B");
    expect(v.rounds).toHaveLength(3);
    expect(v.terms).toMatchObject({ proposedBy: { handle: "ben" }, awaiting: { handle: "ann" }, counterCount: 1 });
    expect(v.terms.previousRules?.roundCount).toBe(5);
    expect(v.viewer).toMatchObject({ canAccept: true, canCounter: true });
    expect((await getBattleView(deps, u.ben!, id)).viewer.canAccept).toBe(false);
    expect((await listBattles(deps, u.ann!, "mine")).find((b) => b.id === id)?.viewerAction).toBe("accept");
    expect((await listBattles(deps, u.ben!, "mine")).find((b) => b.id === id)?.viewerAction).toBe("wait");
    await expect(acceptBattle(deps, u.ben!, id)).rejects.toMatchObject({ code: "NOT_YOUR_TURN" });

    await acceptBattle(deps, u.ann!, id);
    v = await getBattleView(deps, u.ann!, id);
    expect(v.status).toBe("IN_PROGRESS");
    expect(v.rules).toMatchObject({ roundCount: 3, tracksPerRound: 2, judging: { mode: "COMBINED", aiWeightPercent: 40 } });

    // Picks must be a set of two, in genre and era.
    await expect(submitPick(deps, u.ann!, id, 0, { catalogIds: ["VYBZ_DEMO:neon-hallway"] })).rejects.toMatchObject({ code: "WRONG_TRACK_COUNT" });
    await expect(submitPick(deps, u.ann!, id, 0, { catalogIds: ["VYBZ_DEMO:neon-hallway", "VYBZ_DEMO:glass-parade"] })).rejects.toMatchObject({ code: "TRACK_OUTSIDE_GENRE" });
    await submitPick(deps, u.ann!, id, 0, { catalogIds: ["VYBZ_DEMO:neon-hallway", "VYBZ_DEMO:velvet-circuit"] }); // R&B 2003, Soul 2001
    await submitPick(deps, u.ben!, id, 0, { catalogIds: ["VYBZ_DEMO:midnight-static", "VYBZ_DEMO:low-tide-signal"] }); // R&B 2005, 2006

    // The AI judge rules once, blind: no handles, A/B order, both tracks per side.
    expect(await ensureAiVerdicts(deps, id)).toBe(true);
    expect(await ensureAiVerdicts(deps, id)).toBe(false);
    expect(judge.inputs).toHaveLength(1);
    const input = judge.inputs[0]!;
    expect(input).toMatchObject({ genres: ["rnb"], eraFrom: 2000, eraTo: 2009, roundNumber: 1 });
    expect(input.sides.map((s) => s.tracks.length)).toEqual([2, 2]);
    expect(JSON.stringify(input)).not.toMatch(/ann|ben/);

    // The verdict stays hidden while voting is open.
    v = await getBattleView(deps, u.cat!, id);
    const round = v.rounds[0]!;
    expect(round.entries.map((e) => e.tracks.length)).toEqual([2, 2]);
    expect(round.ai).toBeNull();

    // Cat must listen to all four tracks, then votes for the side the AI did NOT pick.
    const aiPickedTitles = input.sides[0]!.tracks.map((t) => t.title);
    const other = round.entries.find((e) => !aiPickedTitles.includes(e.tracks[0]!.track.title))!;
    for (const e of round.entries) {
      for (const t of e.tracks) await recordListen(deps, u.cat!, id, 0, { submissionId: t.submissionId, playedMs: 0, tier: "HOSTED_FULL" });
    }
    await castVote(deps, u.cat!, id, 0, other.submissionId);

    // Combined: one crowd vote (100% for the other side × 60%) beats the AI's 40%.
    tick(31 * MIN);
    v = await getBattleView(deps, u.cat!, id);
    const scored = v.rounds[0]!;
    expect(scored.status).toBe("SCORED");
    expect(scored.winnerParticipantId).toBe(other.participantId ?? scored.crowdWinnerParticipantId);
    expect(scored.crowdWinnerParticipantId).toBe(scored.winnerParticipantId);
    expect(scored.ai).toMatchObject({ reason: "Side A fits the theme better.", model: "fake-1", confidence: 0.8 });
    expect(scored.ai!.participantId).not.toBe(scored.winnerParticipantId);
    // The breakdown names who had each edge (the AI's pick on fit; even on awards).
    expect(scored.ai!.breakdown).toEqual([
      { criterion: "fit", label: "Theme fit", participantId: scored.ai!.participantId, note: "Right on theme" },
      { criterion: "recognition", label: "Awards and recognition", participantId: null, note: "Both award winners" },
    ]);
    expect(v.aiScorecard).toEqual({ [scored.ai!.participantId]: 1, [scored.winnerParticipantId!]: 0 });
  });

  it("AI-only battles: the crowd listens, the AI decides", async () => {
    judge.pick = "B";
    const { id } = await createBattle(deps, u.cat!, { title: "Robot ref", rules: { roundCount: 3, judging: { mode: "AI" }, ...fast } });
    await acceptBattle(deps, u.dan!, id);
    await submitPick(deps, u.cat!, id, 0, { catalogIds: ["VYBZ_DEMO:pulse-garden"] });
    await submitPick(deps, u.dan!, id, 0, { catalogIds: ["VYBZ_DEMO:paper-satellites"] });

    let v = await getBattleView(deps, u.ann!, id);
    expect(v.rounds[0]!.viewer.voteBlockedReason).toBe("AI_JUDGED");
    expect(v.viewer.action).toBe("none");
    expect((await listBattles(deps, u.ann!, "vote")).map((b) => b.id)).not.toContain(id);
    await expect(castVote(deps, u.ann!, id, 0, v.rounds[0]!.entries[0]!.submissionId)).rejects.toMatchObject({ code: "AI_JUDGED" });

    await ensureAiVerdicts(deps, id);
    tick(31 * MIN);
    v = await getBattleView(deps, u.ann!, id);
    expect(v.rounds[0]!.status).toBe("SCORED");
    expect(v.rounds[0]!.winnerParticipantId).toBe(v.rounds[0]!.ai!.participantId);
    expect(v.rounds[0]!.totalVotes).toBeNull();
  });

  it("refuses AI modes when no AI judge is configured", async () => {
    const noAi = { ...deps, aiJudge: null };
    await expect(createBattle(noAi, u.ann!, { title: "Needs AI", rules: { judging: { mode: "SEPARATE" } } })).rejects.toMatchObject({ code: "AI_JUDGE_UNAVAILABLE" });
    const { id } = await createBattle(noAi, u.ann!, { title: "Crowd only" });
    await expect(counterBattle(noAi, u.ben!, id, { rules: { judging: { mode: "AI" } } })).rejects.toMatchObject({ code: "AI_JUDGE_UNAVAILABLE" });
  });
});

describe("AnthropicJudge", () => {
  const input: JudgeInput = {
    battleTitle: "90s R&B",
    theme: "90s R&B",
    genres: ["rnb"],
    eraFrom: 1990,
    eraTo: 1999,
    roundNumber: 2,
    suddenDeath: false,
    sides: [
      { label: "A", tracks: [{ title: "Song One", artistName: "Artist X", albumName: "LP", releaseYear: 1996, genres: ["R&B/Soul"], durationMs: 240000 }] },
      { label: "B", tracks: [{ title: "Song Two", artistName: "Artist Y", albumName: null, releaseYear: 1994, genres: [], durationMs: null, youtubeViews: 1_240_000_000 }] },
    ],
  };

  it("sends a schema-constrained request and parses the verdict", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      const verdict = {
        winner: "B",
        confidence: 0.7,
        reason: "B is the stronger slow jam.",
        // Out of order, with a repeat: kept once each, in rubric order.
        breakdown: [
          { criterion: "legacy", edge: "B", note: "Still a wedding staple" },
          { criterion: "fit", edge: "EVEN", note: "Both 90s R&B" },
          { criterion: "fit", edge: "A", note: "dupe" },
        ],
      };
      return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(verdict) }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const j = new AnthropicJudge({ apiKey: "k", model: "claude-sonnet-5-5", fetch: fakeFetch });
    expect(await j.judge(input)).toEqual({
      winner: "B",
      confidence: 0.7,
      reason: "B is the stronger slow jam.",
      model: "claude-sonnet-5-5",
      breakdown: [
        { criterion: "fit", edge: "EVEN", note: "Both 90s R&B" },
        { criterion: "legacy", edge: "B", note: "Still a wedding staple" },
      ],
    });
    const body = JSON.parse(String(sent!.init.body));
    // The rubric and its guardrails are in the prompt.
    expect(body.system).toContain("Awards and recognition");
    expect(body.system).toContain("Legacy and replay value");
    expect(body.system).toContain("Never state other streaming numbers from memory");
    expect(body.system).toContain("Don't count being unknown against them");
    expect(sent!.url).toBe("https://api.anthropic.com/v1/messages");
    expect((sent!.init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.messages[0].content).toContain('"Song One"');
  });

  it("describes the round without identities", () => {
    const text = describeForJudge(input);
    expect(text).toContain("Genre: R&B");
    expect(text).toContain("Era: 1990–1999");
    expect(text).toContain("Side A:");
    expect(text).toContain("1.2B YouTube views today");
    const recent = describeForJudge({ ...input, sides: [{ label: "A", tracks: [{ title: "New One", artistName: "Z", albumName: null, releaseYear: 2026, genres: [], durationMs: null, recent: true }] }, input.sides[1]!] });
    expect(recent).toContain("2026 · recent");
  });

  it("surfaces refusals and malformed output as errors", async () => {
    const respond = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    await expect(new AnthropicJudge({ apiKey: "k", model: "m", fetch: respond({ stop_reason: "refusal", content: [] }) }).judge(input)).rejects.toThrow("declined");
    await expect(new AnthropicJudge({ apiKey: "k", model: "m", fetch: respond({ content: [{ type: "text", text: '{"winner":"C"}' }] }) }).judge(input)).rejects.toThrow("invalid");
  });
});
