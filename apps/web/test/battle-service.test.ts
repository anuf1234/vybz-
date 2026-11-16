import { type DbHandle, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/server/auth";
import {
  type BattleDeps,
  type UserRow,
  acceptBattle,
  advanceAllDue,
  castVote,
  createBattle,
  getBattleView,
  listBattles,
  profile,
  rankings,
  recordListen,
  rematch,
  submitPick,
} from "../src/server/battles/service";
import type { Mail } from "../src/server/mailer";
import { TEST_DB_URL, freshDb } from "./helpers";

const MIN = 60_000;

describe.skipIf(!TEST_DB_URL)("battle service on Postgres", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let clock = Date.now();
  const tick = (ms: number) => (clock += ms);
  const mail: Mail[] = [];
  const users: Record<string, UserRow> = {};

  const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });

  beforeAll(async () => {
    h = await freshDb();
    deps = {
      db: h.db,
      catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" },
      requireVerifiedEmail: true,
      aiJudge: null,
      now: () => new Date(clock),
    };

    const auth = createAuth({
      db: h.db,
      baseURL: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret-123",
      requireEmailVerification: true,
      mailer: async (m) => void mail.push(m),
      mobileScheme: "vybz",
      disableRateLimit: true,
    });
    for (const name of ["alice", "bob", "carol", "dave"]) {
      await auth.api.signUpEmail({ body: { name: name[0]!.toUpperCase() + name.slice(1), email: `${name}@example.com`, password: "correct-horse-battery" } });
    }
    // Verify everyone except dave through the real verification link.
    for (const name of ["alice", "bob", "carol"]) {
      const m = mail.find((x) => x.to === `${name}@example.com` && x.subject.includes("Verify"))!;
      const url = new URL(/https?:\/\/\S+/.exec(m.text)![0]);
      const res = await auth.handler(new Request(url));
      expect(res.status).toBeLessThan(400);
    }
    for (const row of await h.db.select().from(schema.user)) users[row.handle] = row;
  });

  afterAll(() => h?.close());

  it("signs users up with generated handles and verification state", () => {
    expect(Object.keys(users).sort()).toEqual(["alice", "bob", "carol", "dave"]);
    expect(users.alice!.emailVerified).toBe(true);
    expect(users.dave!.emailVerified).toBe(false);
    expect(users.alice!.role).toBe("USER");
  });

  it("refuses battles from unverified users and challenges to unknown handles", async () => {
    await expect(createBattle(deps, users.dave!, { title: "Nope" })).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    await expect(createBattle(deps, users.alice!, { title: "Nope", opponentHandle: "ghost" })).rejects.toMatchObject({ code: "OPPONENT_NOT_FOUND" });
    await expect(createBattle(deps, users.alice!, { title: "Nope", rules: { roundCount: 4 } })).rejects.toMatchObject({ code: "INVALID_RULES" });
  });

  let battleId = "";

  it("runs a full 3-round battle with sealed picks, blind voting and the listen gate", async () => {
    ({ id: battleId } = await createBattle(deps, users.alice!, {
      title: "2000s R&B",
      theme: "2000s R&B",
      opponentHandle: "bob",
      rules: {
        roundCount: 3,
        timing: { submissionWindowMinutes: 30, votingWindowMinutes: 30 },
        constraints: { eraFrom: 2000, eraTo: 2009 },
        fairListen: { minPlayedMs: 10_000 },
      },
    }));

    // Bob sees it waiting for him; Carol can't accept a direct challenge.
    expect((await listBattles(deps, users.bob!, "mine"))[0]).toMatchObject({ id: battleId, viewerAction: "accept" });
    await expect(acceptBattle(deps, users.carol!, battleId)).rejects.toMatchObject({ code: "NOT_INVITED" });
    await acceptBattle(deps, users.bob!, battleId);

    // Era rule: 2012 is out.
    await expect(submitPick(deps, users.alice!, battleId, 0, { catalogIds: ["VYBZ_DEMO:pulse-garden"] })).rejects.toMatchObject({ code: "TRACK_OUTSIDE_ERA" });
    await submitPick(deps, users.alice!, battleId, 0, { catalogIds: ["VYBZ_DEMO:neon-hallway"] });

    // Sealed: Bob can't see Alice's pick yet, but knows she submitted.
    let bobView = await getBattleView(deps, users.bob!, battleId);
    expect(bobView.rounds[0]!.entries).toEqual([]);
    expect(bobView.rounds[0]!.viewer.opponentSubmitted).toBe(true);
    expect(bobView.viewer.action).toBe("submit");
    await expect(submitPick(deps, users.bob!, battleId, 0, { catalogIds: ["VYBZ_DEMO:neon-hallway"] })).rejects.toMatchObject({ code: "TRACK_ALREADY_USED" });
    await submitPick(deps, users.bob!, battleId, 0, { catalogIds: ["VYBZ_DEMO:midnight-static"] });

    // Voting is open. Carol (audience) sees two blind entries at parity tier.
    let carolView = await getBattleView(deps, users.carol!, battleId);
    let round = carolView.rounds[0]!;
    expect(round.status).toBe("VOTING_OPEN");
    expect(round.entries).toHaveLength(2);
    expect(round.entries.every((e) => e.participantId === null)).toBe(true);
    expect(round.viewer.parityTier).toBe("HOSTED_FULL");
    expect(round.entries[0]!.tracks[0]!.playback).toMatchObject({ tier: "HOSTED_FULL" });
    expect(round.totalVotes).toBeNull(); // AT_ROUND_CLOSE by default
    expect(round.viewer.voteBlockedReason).toBe("LISTEN_REQUIRED");

    const [e1, e2] = round.entries;
    await expect(castVote(deps, users.carol!, battleId, 0, e1!.submissionId)).rejects.toMatchObject({ code: "LISTEN_REQUIRED" });

    // Participants can't vote; unverified Dave can't either.
    await expect(castVote(deps, users.alice!, battleId, 0, e1!.submissionId)).rejects.toMatchObject({ code: "PARTICIPANT" });
    await expect(castVote(deps, users.dave!, battleId, 0, e1!.submissionId)).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });

    // Listening: inflated reports are capped at wall-clock time.
    await recordListen(deps, users.carol!, battleId, 0, { submissionId: e1!.submissionId, playedMs: 0, tier: "HOSTED_FULL" });
    tick(3_000);
    const capped = await recordListen(deps, users.carol!, battleId, 0, { submissionId: e1!.submissionId, playedMs: 40_000, tier: "HOSTED_FULL" });
    expect(capped.playedMs).toBe(5_000);
    await expect(recordListen(deps, users.carol!, battleId, 0, { submissionId: e1!.submissionId, playedMs: 1, tier: "EMBED" })).rejects.toMatchObject({ code: "INVALID_TIER" });

    await recordListen(deps, users.carol!, battleId, 0, { submissionId: e2!.submissionId, playedMs: 0, tier: "HOSTED_FULL" });
    tick(12_000);
    await recordListen(deps, users.carol!, battleId, 0, { submissionId: e1!.submissionId, playedMs: 12_000, tier: "HOSTED_FULL" });
    await recordListen(deps, users.carol!, battleId, 0, { submissionId: e2!.submissionId, playedMs: 12_000, tier: "HOSTED_FULL" });

    carolView = await getBattleView(deps, users.carol!, battleId);
    expect(carolView.rounds[0]!.viewer.canVote).toBe(true);
    expect(carolView.viewer.action).toBe("vote");
    expect((await listBattles(deps, users.carol!, "vote")).map((b) => b.id)).toContain(battleId);

    const aliceSub = (await getBattleView(deps, users.alice!, battleId)).rounds[0]!.viewer.mySubmission!.submissionId;
    await castVote(deps, users.carol!, battleId, 0, aliceSub);
    await expect(castVote(deps, users.carol!, battleId, 0, aliceSub)).rejects.toMatchObject({ code: "ALREADY_VOTED" });
    expect((await listBattles(deps, users.carol!, "vote")).map((b) => b.id)).not.toContain(battleId);

    // Round closes on the scheduler; Alice takes round 1 and identities are revealed.
    tick(31 * MIN);
    expect(await advanceAllDue(deps)).toBe(1);
    carolView = await getBattleView(deps, users.carol!, battleId);
    round = carolView.rounds[0]!;
    expect(round.status).toBe("SCORED");
    expect(round.totalVotes).toBe(1);
    const alicePid = carolView.participants.find((p) => p.user.handle === "alice")!.id;
    expect(round.winnerParticipantId).toBe(alicePid);
    expect(round.entries.find((e) => e.submissionId === aliceSub)!.participantId).toBe(alicePid);
    expect(carolView.rounds[1]!.status).toBe("SUBMISSIONS_OPEN");

    // Round 2: Bob doesn't submit and forfeits it.
    await submitPick(deps, users.alice!, battleId, 1, { catalogIds: ["VYBZ_DEMO:velvet-circuit"] });
    tick(31 * MIN);
    let view = await getBattleView(deps, users.alice!, battleId); // lazy advance on read
    expect(view.rounds[1]).toMatchObject({ status: "SCORED", winnerParticipantId: alicePid });

    // Round 3: both submit, nobody votes; voting extends once, then it's a draw.
    await submitPick(deps, users.alice!, battleId, 2, { catalogIds: ["VYBZ_DEMO:glass-parade"] });
    await submitPick(deps, users.bob!, battleId, 2, { catalogIds: ["VYBZ_DEMO:low-tide-signal"] });
    tick(31 * MIN);
    view = await getBattleView(deps, users.alice!, battleId);
    expect(view.rounds[2]!.status).toBe("VOTING_OPEN");
    tick(31 * MIN);
    view = await getBattleView(deps, users.alice!, battleId);
    expect(view.status).toBe("COMPLETE");
    expect(view.winnerParticipantId).toBe(alicePid);
    expect(view.participants.find((p) => p.id === alicePid)!.roundsWon).toBe(2);
    expect(view.viewer.canRematch).toBe(true);
  });

  it("ranks players and shows records on profiles", async () => {
    const r = await rankings(deps);
    expect(r[0]).toMatchObject({ rank: 1, user: { handle: "alice" }, wins: 1, losses: 0, roundsWon: 2 });
    expect(r[1]).toMatchObject({ user: { handle: "bob" }, wins: 0, losses: 1 });
    const p = await profile(deps, null, "alice");
    expect(p.record).toMatchObject({ wins: 1, battles: 1 });
    expect(p.recent[0]!.id).toBe(battleId);
  });

  it("creates a rematch as a direct challenge to the same opponent", async () => {
    await expect(rematch(deps, users.carol!, battleId)).rejects.toMatchObject({ code: "NOT_PARTICIPANT" });
    const { id } = await rematch(deps, users.bob!, battleId);
    const v = await getBattleView(deps, users.alice!, id);
    expect(v).toMatchObject({ status: "PENDING_ACCEPT", title: "Rematch: 2000s R&B", rematchOfId: battleId, invited: { handle: "alice" } });
    expect(v.rules.constraints).toEqual({ eraFrom: 2000, eraTo: 2009 });
  });

  it("lists open challenges for others and expires them", async () => {
    const { id } = await createBattle(deps, users.carol!, { title: "Open mic", rules: { challengeExpiryHours: 1 } });
    expect((await listBattles(deps, users.alice!, "open")).map((b) => b.id)).toContain(id);
    expect((await listBattles(deps, users.carol!, "open")).map((b) => b.id)).not.toContain(id);
    tick(61 * MIN);
    expect((await getBattleView(deps, null, id)).status).toBe("EXPIRED");
    await expect(acceptBattle(deps, users.alice!, id)).rejects.toMatchObject({ code: "NOT_OPEN" });
  });

  it("doesn't demand verified emails for voting when the deployment doesn't verify", async () => {
    const lax = { ...deps, requireVerifiedEmail: false };
    const { id } = await createBattle(lax, users.alice!, { title: "Lax", rules: { roundCount: 3, fairListen: { minPlayedMs: 0 } } });
    await acceptBattle(lax, users.bob!, id);
    await submitPick(lax, users.alice!, id, 0, { catalogIds: ["VYBZ_DEMO:neon-hallway"] });
    await submitPick(lax, users.bob!, id, 0, { catalogIds: ["VYBZ_DEMO:midnight-static"] });
    const v = await getBattleView(lax, users.dave!, id); // dave never verified
    expect(v.rounds[0]!.viewer.voteBlockedReason).toBe("LISTEN_REQUIRED");
    expect((await getBattleView(deps, users.dave!, id)).rounds[0]!.viewer.voteBlockedReason).toBe("EMAIL_NOT_VERIFIED");
  });

  it("keeps suspended accounts out", async () => {
    await h.db.update(schema.user).set({ status: "SUSPENDED" }).where(eq(schema.user.id, users.carol!.id));
    const [carol] = await h.db.select().from(schema.user).where(eq(schema.user.id, users.carol!.id));
    await expect(createBattle(deps, carol!, { title: "Hello" })).rejects.toMatchObject({ code: "ACCOUNT_RESTRICTED" });
  });
});
