/**
 * The battle engine against a real Postgres, with a controllable clock and
 * the sample catalog standing in for Apple Music. Skipped without DATABASE_URL.
 */
import type { Actor } from "@vybz/core";
import { FIXTURE_TRACKS, FixtureMusicAdapter } from "@vybz/providers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;

describe.skipIf(!DATABASE_URL)("battle engine (integration)", async () => {
  const { prisma } = await import("@vybz/db");
  const { battleService } = await import("../src/lib/battles/service");
  const { AppError } = await import("../src/lib/errors");
  const { BADGES } = await import("../src/lib/progression");

  let clock = new Date("2026-10-16T12:00:00Z");
  const tick = (ms: number) => void (clock = new Date(clock.getTime() + ms));
  const svc = battleService({ prisma, catalog: new FixtureMusicAdapter("/api/dev/tone"), now: () => clock });
  const id = (title: string) => FIXTURE_TRACKS.find((t) => t.title === title)!.externalId;

  async function user(username: string, extra: Partial<Actor> = {}): Promise<Actor> {
    const u = await prisma.user.create({
      data: {
        id: `u_${username}`,
        name: username,
        email: `${username}@example.com`,
        emailVerified: true,
        profile: { create: { username, displayName: username } },
      },
    });
    return { id: u.id, role: "USER", status: "ACTIVE", emailVerified: true, handle: username, ...extra };
  }

  const setup = (over: Record<string, unknown> = {}) => ({
    type: "SONG_FOR_SONG",
    mode: "DIRECT",
    title: "2000s R&B Battle",
    theme: "2000s R&B",
    genre: "R&B",
    tagline: null,
    roundCount: 3,
    playlistLength: null,
    visibility: "PUBLIC",
    votingDurationMs: H,
    revealIntervalMs: 0,
    hideTotals: true,
    eraFrom: 1995,
    eraTo: 2009,
    scheduledFor: null,
    ...over,
  });
  const A = ["No Scrubs", "Crazy in Love", "Umbrella"].map(id);
  const B = ["Say My Name", "Yeah!", "Irreplaceable"].map(id);

  /** Sent, accepted and both lineups locked: live and voting. */
  async function liveBattle(over: Record<string, unknown> = {}) {
    const [a, b] = [await user("alice"), await user("bob")];
    const { id: battleId } = await svc.create(a, { setup: setup(over), opponent: "@Bob", lineup: { appleIds: A } });
    await svc.accept(b, battleId);
    await svc.submitLineup(b, battleId, { appleIds: B });
    return { a, b, battleId };
  }

  /** Listens to both sides of a round honestly (the clock moves), then votes. */
  async function listenAndVote(voter: Actor, battleId: string, roundIndex: number, selection: 0 | 1) {
    const subs = await prisma.battleSubmission.findMany({ where: { battleId, round: { index: roundIndex } }, orderBy: { side: "asc" } });
    for (const s of subs) {
      await svc.reportListen(voter, { submissionId: s.id, playedMs: 0 });
      tick(11_000);
      await svc.reportListen(voter, { submissionId: s.id, playedMs: 11_000 });
    }
    return svc.vote(voter, { battleId, roundIndex, selection });
  }

  const status = async (battleId: string) => (await prisma.battle.findUniqueOrThrow({ where: { id: battleId } })).status;

  beforeEach(async () => {
    clock = new Date("2026-10-16T12:00:00Z");
    await prisma.$executeRawUnsafe('TRUNCATE "users", "music_tracks", "badges", "rate_limits" CASCADE');
    await prisma.badge.createMany({ data: BADGES.map((b) => ({ ...b })) });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs a full battle: challenge, accept, lineups, votes, results", async () => {
    const { a, b, battleId } = await liveBattle();
    expect(await status(battleId)).toBe("VOTING");

    const [fan1, fan2, fan3] = [await user("fan1"), await user("fan2"), await user("fan3")];
    // Round 0: A 2–1. Round 1: B 3–0. Round 2: A 2–1. A wins 2–1 on rounds.
    for (const [voter, picks] of [
      [fan1, [0, 1, 0]],
      [fan2, [0, 1, 0]],
      [fan3, [1, 1, 1]],
    ] as const) {
      for (const [round, side] of picks.entries()) await listenAndVote(voter, battleId, round, side);
    }

    tick(H);
    await svc.advanceDue();
    const done = await prisma.battle.findUniqueOrThrow({ where: { id: battleId }, include: { rounds: { orderBy: { index: "asc" } }, events: true } });
    expect(done).toMatchObject({ status: "COMPLETED", scoreA: 2, scoreB: 1, winnerSide: 0, totalVoters: 3 });
    expect(done.rounds.map((r) => [r.votesA, r.votesB, r.winnerSide])).toEqual([
      [2, 1, 0],
      [0, 3, 1],
      [2, 1, 0],
    ]);
    // Crowd favorite: round 1's B pick with 3 votes.
    const fav = await prisma.battleSubmission.findUniqueOrThrow({ where: { id: done.crowdFavoriteId! }, include: { track: true } });
    expect(fav.track?.title).toBe("Yeah!");
    expect(done.events.map((e) => e.kind).sort()).toEqual(
      ["ACCEPTED->SCHEDULED", "ACTIVE->VOTING", "CHALLENGE_SENT->ACCEPTED", "DRAFT->CHALLENGE_SENT", "SCHEDULED->ACTIVE", "VOTING->COMPLETED"].sort(),
    );

    // XP, badges and notifications.
    const pa = await prisma.profile.findUniqueOrThrow({ where: { userId: a.id } });
    const pb = await prisma.profile.findUniqueOrThrow({ where: { userId: b.id } });
    expect(pa.xp).toBe(25 + 50);
    expect(pb.xp).toBe(25 + 15);
    const badges = await prisma.userBadge.findMany({ where: { userId: a.id }, include: { badge: true } });
    expect(badges.map((x) => x.badge.code).sort()).toEqual(["FIRST_BATTLE", "FIRST_WIN"]);
    expect(await prisma.notification.count({ where: { recipientId: a.id, type: "BATTLE_RESULT" } })).toBe(1);

    // Results are final: sweeping again changes nothing.
    tick(DAY);
    expect(await svc.advanceDue()).toBe(0);
  });

  it("validates votes on the server", async () => {
    const { a, battleId } = await liveBattle();
    const fan = await user("fan");
    const subs = await prisma.battleSubmission.findMany({ where: { battleId, round: { index: 0 } }, orderBy: { side: "asc" } });

    // Not listened yet.
    await expect(svc.vote(fan, { battleId, roundIndex: 0, selection: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Claiming a long listen 2 seconds in earns only what's plausible.
    await svc.reportListen(fan, { submissionId: subs[0]!.id, playedMs: 0 });
    tick(2_000);
    expect((await svc.reportListen(fan, { submissionId: subs[0]!.id, playedMs: 30_000 })).playedMs).toBeLessThanOrEqual(4_000);
    // Playing both sides at once doesn't double the credit.
    await svc.reportListen(fan, { submissionId: subs[1]!.id, playedMs: 0 });
    tick(10_000);
    await svc.reportListen(fan, { submissionId: subs[0]!.id, playedMs: 12_000 });
    await svc.reportListen(fan, { submissionId: subs[1]!.id, playedMs: 10_000 });
    await expect(svc.vote(fan, { battleId, roundIndex: 0, selection: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Players can't vote; nobody votes twice; unknown rounds are refused.
    await expect(listenAndVote(a, battleId, 1, 0)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await listenAndVote(fan, battleId, 1, 1);
    await expect(svc.vote(fan, { battleId, roundIndex: 1, selection: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(svc.vote(fan, { battleId, roundIndex: 7, selection: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.vote.count()).toBe(1);

    // Unverified accounts and guests can't vote.
    await expect(svc.vote({ ...fan, emailVerified: false }, { battleId, roundIndex: 0, selection: 0 })).rejects.toBeInstanceOf(AppError);
    await expect(svc.vote(null, { battleId, roundIndex: 0, selection: 0 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses votes once voting closes", async () => {
    const { battleId } = await liveBattle();
    const fan = await user("fan");
    tick(H + 1);
    await expect(listenAndVote(fan, battleId, 0, 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A refused vote still commits the transitions that were due.
    await expect(svc.vote(fan, { battleId, roundIndex: 0, selection: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await status(battleId)).toBe("COMPLETED");
  });

  it("reveals rounds on a premiere schedule", async () => {
    const { battleId } = await liveBattle({ revealIntervalMs: 10 * MIN, scheduledFor: new Date("2026-10-16T13:00:00Z") });
    expect(await status(battleId)).toBe("SCHEDULED");
    const fan = await user("fan");
    tick(H + MIN); // 13:01: round 0 is out
    await svc.advance(battleId);
    expect(await status(battleId)).toBe("ACTIVE");
    await listenAndVote(fan, battleId, 0, 0);
    await expect(listenAndVote(fan, battleId, 2, 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(svc.vote(fan, { battleId, roundIndex: 2, selection: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
    tick(20 * MIN); // all three out
    await svc.advance(battleId);
    expect(await status(battleId)).toBe("VOTING");
  });

  it("checks challenge rules: invitee only, era, lineup size, no self-challenge", async () => {
    const [a] = [await user("alice"), await user("bob")];
    const eve = await user("eve");
    await expect(svc.create(a, { setup: setup(), opponent: "alice", lineup: { appleIds: A } })).rejects.toMatchObject({ code: "INVALID" });
    await expect(svc.create(a, { setup: setup(), opponent: "bob", lineup: { appleIds: A.slice(0, 2) } })).rejects.toMatchObject({
      message: expect.stringContaining("exactly 3"),
    });
    await expect(
      svc.create(a, { setup: setup(), opponent: "bob", lineup: { appleIds: [A[0], A[1], id("Kill Bill")] } }),
    ).rejects.toMatchObject({ message: expect.stringContaining("2022") });
    await expect(svc.create(a, { setup: setup({ type: "LIVE_DJ", roundCount: 1 }), opponent: "bob", lineup: { appleIds: A } })).rejects.toMatchObject({
      code: "INVALID",
    });

    const { id: battleId } = await svc.create(a, { setup: setup(), opponent: "bob", lineup: { appleIds: A } });
    await expect(svc.accept(a, battleId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(svc.accept(eve, battleId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.notification.count({ where: { recipientId: "u_bob", type: "CHALLENGE_RECEIVED" } })).toBe(1);
  });

  it("lets anyone take an open challenge, and finds it for matchmaking", async () => {
    const marcus = await user("marcus");
    const stranger = await user("stranger");
    const { id: battleId } = await svc.create(marcus, {
      setup: setup({ mode: "OPEN", tagline: "Nobody beats my 2000s R&B." }),
      lineup: { appleIds: A },
    });
    expect(await svc.findMatch(stranger, { theme: "2000S R&B", type: "SONG_FOR_SONG", roundCount: 3 })).toEqual({ id: battleId });
    expect(await svc.findMatch(marcus, { theme: "2000s R&B", type: "SONG_FOR_SONG", roundCount: 3 })).toBeNull();

    await svc.accept(stranger, battleId);
    const other = await user("other");
    await expect(svc.accept(other, battleId)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.userBadge.count({ where: { userId: stranger.id } })).toBe(1); // Open Door
  });

  it("expires challenges and cancels battles with a missed lineup", async () => {
    const a = await user("alice");
    const b = await user("bob");
    const { id: open } = await svc.create(a, { setup: setup({ mode: "OPEN" }), lineup: { appleIds: A } });
    const { id: direct } = await svc.create(a, { setup: setup(), opponent: "bob", lineup: { appleIds: B } });
    await svc.accept(b, direct);
    tick(2 * DAY);
    await svc.advanceDue();
    expect(await prisma.battle.findUniqueOrThrow({ where: { id: direct } })).toMatchObject({ status: "CANCELLED", cancelReason: "LINEUP_MISSED" });
    tick(DAY);
    await svc.advanceDue();
    expect(await prisma.battle.findUniqueOrThrow({ where: { id: open } })).toMatchObject({ status: "CANCELLED", cancelReason: "EXPIRED" });
  });

  it("lets the invitee decline and the creator withdraw, but not after it goes live", async () => {
    const a = await user("alice");
    const b = await user("bob");
    const { id: first } = await svc.create(a, { setup: setup(), opponent: "bob", lineup: { appleIds: A } });
    await svc.cancel(b, first);
    expect(await prisma.battle.findUniqueOrThrow({ where: { id: first } })).toMatchObject({ status: "CANCELLED", cancelReason: "DECLINED" });

    const { id: second } = await svc.create(a, { setup: setup(), opponent: "bob", lineup: { appleIds: A } });
    await svc.accept(b, second);
    await svc.submitLineup(b, second, { appleIds: B });
    await expect(svc.cancel(a, second)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("runs a playlist battle as one round of playlist vs playlist", async () => {
    const { battleId } = await liveBattle({ type: "PLAYLIST", roundCount: 1, playlistLength: 3 });
    const subs = await prisma.battleSubmission.findMany({ where: { battleId }, include: { playlist: { include: { tracks: true } } } });
    expect(subs).toHaveLength(2);
    expect(subs.every((s) => s.playlist?.tracks.length === 3)).toBe(true);
    const fan = await user("fan");
    await listenAndVote(fan, battleId, 0, 1);
    tick(H);
    await svc.advanceDue();
    expect(await prisma.battle.findUniqueOrThrow({ where: { id: battleId } })).toMatchObject({ status: "COMPLETED", winnerSide: 1, scoreB: 1 });
  });

  it("starts a rematch as a direct challenge to the same opponent", async () => {
    const { a, b, battleId } = await liveBattle();
    const fan = await user("fan");
    await expect(svc.create(a, { setup: setup(), lineup: { appleIds: A }, rematchOf: battleId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    tick(H);
    await svc.advanceDue();
    await expect(svc.create(fan, { setup: setup(), lineup: { appleIds: A }, rematchOf: battleId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const re = await svc.create(b, { setup: setup(), lineup: { appleIds: B }, rematchOf: battleId });
    expect(await prisma.battle.findUniqueOrThrow({ where: { id: re.id } })).toMatchObject({
      status: "CHALLENGE_SENT",
      creatorId: b.id,
      invitedUserId: a.id,
      rematchOfId: battleId,
    });
  });
});
