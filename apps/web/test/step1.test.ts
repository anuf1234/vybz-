import { type DbHandle, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureDailyBattle } from "../src/server/daily";
import {
  type BattleDeps,
  type UserRow,
  castVote,
  createBattle,
  getBattleView,
  joinBattle,
  leaveBattle,
  listBattles,
  recordListen,
  setFeatured,
  setHeart,
  startBattle,
  submitPick,
} from "../src/server/battles/service";
import { chatProblem, heartbeat, liveView, postChat, react } from "../src/server/live";
import { fileReport, listReports, resolveReport } from "../src/server/moderation";
import { type PushMessage, listNotifications, markRead, savePushToken } from "../src/server/notifications";
import { TEST_DB_URL, freshDb } from "./helpers";

const MIN = 60_000;

describe.skipIf(!TEST_DB_URL)("step 1: multi-entry, private battles, live layer, notifications, moderation", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let clock = Date.now();
  const tick = (ms: number) => (clock += ms);
  const pushes: PushMessage[] = [];
  const u: Record<string, UserRow> = {};
  const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });

  beforeAll(async () => {
    h = await freshDb();
    deps = {
      db: h.db,
      catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" },
      requireVerifiedEmail: false,
      aiJudge: null,
      push: async (m) => void pushes.push(...m),
      now: () => new Date(clock),
    };
    for (const handle of ["host", "pla", "plb", "plc", "fan", "outsider", "mod"]) {
      const [row] = await h.db
        .insert(schema.user)
        .values({ id: `u_${handle}`, name: handle, email: `${handle}@x.com`, handle, role: handle === "mod" ? "MODERATOR" : "USER" })
        .returning();
      u[handle] = row!;
    }
    await savePushToken(h.db, u.host!.id, "ExponentPushToken[host-phone-123]", "ios");
  });
  afterAll(() => h?.close());

  const fresh = async (handle: string) => (await h.db.select().from(schema.user).where(eq(schema.user.handle, handle)))[0]!;
  const quick = { timing: { submissionWindowMinutes: 10, votingWindowMinutes: 10 }, fairListen: { minPlayedMs: 0 }, minVotesToCount: 0 };

  let multiId = "";

  it("runs a private multi-entry battle: invite, link access, join, leave, start", async () => {
    ({ id: multiId } = await createBattle(deps, u.host!, {
      title: "Four-way R&B",
      visibility: "PRIVATE",
      inviteHandles: ["pla", "plb"],
      rules: { roundCount: 3, entrants: { min: 3, max: 4 }, ...quick },
    }));
    const hostView = await getBattleView(deps, u.host!, multiId);
    expect(hostView).toMatchObject({ format: "MULTI", visibility: "PRIVATE", entrants: { min: 3, max: 4, joined: 1 } });
    const code = hostView.inviteCode!;
    expect(code).toBeTruthy();

    // Invitees were notified (host's own phone isn't involved yet).
    expect((await listNotifications(h.db, u.pla!.id)).items[0]).toMatchObject({ type: "INVITED", battleId: multiId });

    // Private: outsiders and guests get a 404 without the link; feeds hide it.
    await expect(getBattleView(deps, u.outsider!, multiId)).rejects.toMatchObject({ status: 404 });
    await expect(getBattleView(deps, null, multiId)).rejects.toMatchObject({ status: 404 });
    expect((await listBattles(deps, u.outsider!, "open")).map((b) => b.id)).not.toContain(multiId);
    expect((await listBattles(deps, u.pla!, "mine")).find((b) => b.id === multiId)?.viewerAction).toBe("join");

    // The invite link works for guests (view only) and grants lasting access to signed-in users.
    expect((await getBattleView(deps, null, multiId, undefined, code)).title).toBe("Four-way R&B");
    expect((await getBattleView(deps, u.outsider!, multiId, undefined, code)).viewer.canJoin).toBe(true);
    expect((await getBattleView(deps, u.outsider!, multiId)).inviteCode).toBeNull();
    await expect(joinBattle(deps, u.plc!, multiId)).rejects.toMatchObject({ status: 404 });

    await joinBattle(deps, u.pla!, multiId);
    await joinBattle(deps, u.outsider!, multiId);
    await leaveBattle(deps, u.outsider!, multiId);
    await joinBattle(deps, u.plb!, multiId);
    expect((await listNotifications(h.db, u.host!.id)).items.map((n) => n.type)).toContain("PLAYER_JOINED");
    expect(pushes.some((p) => p.to === "ExponentPushToken[host-phone-123]" && p.title === "New player")).toBe(true);

    let v = await getBattleView(deps, u.host!, multiId);
    expect(v.viewer).toMatchObject({ canStart: true, canJoin: false });
    await expect(startBattle(deps, u.pla!, multiId)).rejects.toMatchObject({ code: "NOT_CREATOR" });
    await startBattle(deps, u.host!, multiId);
    v = await getBattleView(deps, u.plb!, multiId);
    expect(v.status).toBe("IN_PROGRESS");
    expect(v.participants.map((p) => p.user.handle)).toEqual(["host", "pla", "plb"]);
    expect((await listNotifications(h.db, u.plb!.id)).items[0]).toMatchObject({ type: "YOUR_PICK", title: "The battle is on" });
  });

  it("votes among three entries, hearts tracks, and reports stats", async () => {
    await submitPick(deps, u.host!, multiId, 0, { catalogIds: ["VYBZ_DEMO:neon-hallway"] });
    await submitPick(deps, u.pla!, multiId, 0, { catalogIds: ["VYBZ_DEMO:midnight-static"] });
    await submitPick(deps, u.plb!, multiId, 0, { catalogIds: ["VYBZ_DEMO:low-tide-signal"] });

    const fanCode = (await getBattleView(deps, u.host!, multiId)).inviteCode!;
    let v = await getBattleView(deps, u.fan!, multiId, undefined, fanCode);
    const round = v.rounds[0]!;
    expect(round.status).toBe("VOTING_OPEN");
    expect(round.entries).toHaveLength(3);
    expect(round.contenderIds).toHaveLength(3);
    expect((await listNotifications(h.db, u.pla!.id)).items[0]!.type).toBe("VOTING_OPEN");

    const p2Entry = round.entries.find((e) => e.tracks[0]!.track.title === "Low Tide Signal")!;
    // Hearts need a listen first.
    await expect(setHeart(deps, u.fan!, multiId, 0, { submissionId: p2Entry.tracks[0]!.submissionId, hearted: true })).rejects.toMatchObject({ code: "LISTEN_REQUIRED" });
    for (const e of round.entries) await recordListen(deps, u.fan!, multiId, 0, { submissionId: e.tracks[0]!.submissionId, playedMs: 0, tier: "HOSTED_FULL" });
    await setHeart(deps, u.fan!, multiId, 0, { submissionId: p2Entry.tracks[0]!.submissionId, hearted: true });
    await expect(setHeart(deps, u.pla!, multiId, 0, { submissionId: p2Entry.tracks[0]!.submissionId, hearted: true })).rejects.toMatchObject({ code: "PARTICIPANT" });
    v = await getBattleView(deps, u.fan!, multiId);
    expect(v.rounds[0]!.viewer.heartedSubmissionIds).toEqual([p2Entry.tracks[0]!.submissionId]);
    expect(v.rounds[0]!.entries[0]!.tracks[0]!.hearts).toBeNull(); // hidden until the round closes

    await castVote(deps, u.fan!, multiId, 0, p2Entry.submissionId);
    tick(11 * MIN);
    v = await getBattleView(deps, u.fan!, multiId);
    const scored = v.rounds[0]!;
    expect(scored.status).toBe("SCORED");
    const plb = v.participants.find((p) => p.user.handle === "plb")!;
    expect(scored.winnerParticipantId).toBe(plb.id);
    expect(scored.entries.find((e) => e.participantId === plb.id)!.tracks[0]!.hearts).toBe(1);
    expect(v.stats).toMatchObject({ totalVotes: 1, uniqueVoters: 1, listeners: 1, completionRate: 1, topTrack: { hearts: 1, participantId: plb.id } });
    const hostInbox = (await listNotifications(h.db, u.host!.id)).items;
    expect(hostInbox).toEqual(expect.arrayContaining([expect.objectContaining({ type: "ROUND_RESULT", body: expect.stringContaining("@plb took round 1") })]));
    expect(hostInbox).toEqual(expect.arrayContaining([expect.objectContaining({ type: "YOUR_PICK", body: expect.stringContaining("Round 2") })]));
  });

  it("runs chat, reactions and viewer counts with limits", async () => {
    await heartbeat(deps, u.fan!, multiId, null);
    await heartbeat(deps, null, multiId, "guest-key-123456").catch((e) => e); // guests need the link: private → 404
    await heartbeat(deps, u.pla!, multiId, null);
    let live = await liveView(deps, u.fan!, multiId, null);
    expect(live.viewers).toBe(2);

    const m1 = await postChat(deps, u.fan!, multiId, "  That second track!!  ");
    expect(m1.body).toBe("That second track!!");
    await expect(postChat(deps, u.fan!, multiId, "again")).rejects.toMatchObject({ code: "SLOW_DOWN" });
    tick(3_000);
    await expect(postChat(deps, u.fan!, multiId, "check out spam.com")).rejects.toMatchObject({ code: "MESSAGE_BLOCKED" });
    await expect(postChat(deps, u.fan!, multiId, "x".repeat(281))).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
    await expect(postChat(deps, null, multiId, "hi")).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
    const m2 = await postChat(deps, u.pla!, multiId, "Told you 🔥");

    await react(deps, u.fan!, multiId, "🔥", null);
    await react(deps, u.pla!, multiId, "🔥", null);
    await expect(react(deps, u.fan!, multiId, "🍕", null)).rejects.toMatchObject({ code: "INVALID_REACTION" });

    live = await liveView(deps, u.fan!, multiId, null);
    expect(live.messages.map((m) => m.body)).toEqual(["That second track!!", "Told you 🔥"]);
    expect(live.recentReactions["🔥"]).toBe(2);
    expect((await liveView(deps, u.fan!, multiId, m1.id)).messages.map((m) => m.id)).toEqual([m2.id]);

    // Viewers drop off after 30s without a heartbeat.
    tick(31_000);
    expect((await liveView(deps, u.fan!, multiId, null)).viewers).toBe(0);
    expect(chatProblem("hello there", ["badword"])).toBeNull();
    expect(chatProblem("you BADWORD", ["badword"])).toMatch(/rules/);
  });

  it("moderation: report a message, hide it, suspend the author; only staff see the queue", async () => {
    const live = await liveView(deps, u.fan!, multiId, null);
    const msg = live.messages.find((m) => m.user.handle === "pla")!;
    await fileReport(deps, u.fan!, { subjectType: "CHAT_MESSAGE", subjectId: msg.id, reason: "Spamming the chat" });
    await fileReport(deps, u.host!, { subjectType: "CHAT_MESSAGE", subjectId: msg.id, reason: "Rude" });
    await expect(listReports(deps, u.fan!)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const queue = await listReports(deps, await fresh("mod"));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ reportCount: 2, context: { text: "Told you 🔥", user: { handle: "pla" }, battleTitle: "Four-way R&B" } });

    await resolveReport(deps, await fresh("mod"), queue[0]!.id, { action: "HIDE_MESSAGE" });
    expect((await liveView(deps, u.fan!, multiId, null)).messages.map((m) => m.body)).not.toContain("Told you 🔥");
    expect((await liveView(deps, await fresh("mod"), multiId, null)).messages.find((m) => m.id === msg.id)?.hidden).toBe(true);
    expect(await listReports(deps, await fresh("mod"))).toHaveLength(0);

    await fileReport(deps, u.fan!, { subjectType: "USER", subjectId: u.outsider!.id, reason: "Harassment in DMs" });
    const [r] = await listReports(deps, await fresh("mod"));
    await resolveReport(deps, await fresh("mod"), r!.id, { action: "SUSPEND_USER", note: "Repeat harassment" });
    expect((await fresh("outsider")).status).toBe("SUSPENDED");
    const actions = await h.db.select().from(schema.moderationAction);
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["HIDE_MESSAGE", "SUSPEND_USER"]));
  });

  it("features battles and creates exactly one daily battle per day", async () => {
    const { id } = await createBattle(deps, u.plc!, { title: "Open duel", rules: { roundCount: 3 } });
    await expect(setFeatured(deps, u.plc!, id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setFeatured(deps, await fresh("mod"), id, true);
    expect((await listBattles(deps, null, "featured")).map((b) => b.id)).toEqual([id]);

    const d1 = await ensureDailyBattle(deps);
    const d2 = await ensureDailyBattle(deps);
    expect(d1).toBe(d2);
    const daily = await getBattleView(deps, null, d1);
    expect(daily).toMatchObject({ format: "MULTI", dailyDate: new Date(clock).toISOString().slice(0, 10), entrants: { max: 8, joined: 0 } });
    expect(daily.title).toMatch(/^Daily battle: /);
    expect((await listBattles(deps, null, "daily"))[0]!.id).toBe(d1);
    await joinBattle(deps, u.fan!, d1);
    expect((await getBattleView(deps, u.fan!, d1)).participants.map((p) => p.side)).toEqual([0]);
  });

  it("marks notifications read", async () => {
    const before = await listNotifications(h.db, u.pla!.id);
    expect(before.unread).toBeGreaterThan(0);
    await markRead(h.db, u.pla!.id, [before.items[0]!.id]);
    expect((await listNotifications(h.db, u.pla!.id)).unread).toBe(before.unread - 1);
    await markRead(h.db, u.pla!.id, "all");
    expect((await listNotifications(h.db, u.pla!.id)).unread).toBe(0);
  });
});
