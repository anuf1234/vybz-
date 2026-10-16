/**
 * Song battles against a real Postgres, with a controllable clock and the
 * sample catalog standing in for Apple Music. Skipped without DATABASE_URL.
 */
import type { Actor } from "@vybz/core";
import { FIXTURE_TRACKS, FixtureMusicAdapter } from "@vybz/providers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const HOUR = 60 * 60 * 1000;

describe.skipIf(!DATABASE_URL)("song battles (integration)", async () => {
  const { prisma } = await import("@vybz/db");
  const { battleService, BattleError } = await import("../src/lib/battles/service");

  let clock = new Date("2026-10-16T12:00:00Z");
  const tick = (ms: number) => void (clock = new Date(clock.getTime() + ms));
  const svc = battleService({ prisma, now: () => clock });
  const catalog = new FixtureMusicAdapter("/api/dev/tone");
  const id = (title: string) => FIXTURE_TRACKS.find((t) => t.title === title)!.externalId;

  async function user(handle: string, extra: Partial<Actor> = {}): Promise<Actor> {
    const u = await prisma.user.create({
      data: { id: `u_${handle}`, name: handle, email: `${handle}@example.com`, emailVerified: true, handle },
    });
    return { id: u.id, role: "USER", status: "ACTIVE", emailVerified: true, handle, ...extra };
  }

  const rules = { roundCount: 3, pace: "QUICK", eraFrom: 1990, eraTo: 2009 } as const;

  async function startedBattle() {
    const [a, b] = [await user("alice"), await user("bob")];
    const { id: battleId } = await svc.create(a, { theme: "2000s R&B", rules, opponentHandle: "@Bob" });
    await svc.accept(b, battleId);
    return { a, b, battleId };
  }

  /** Listens to both picks of a round in full (clock-honest), then returns the submission ids. */
  async function listenToBoth(voter: Actor, battleId: string, roundIndex: number) {
    const subs = await prisma.submission.findMany({
      where: { battleId, round: { index: roundIndex } },
      orderBy: { side: "asc" },
    });
    for (const s of subs) await svc.reportListen(voter, { submissionId: s.id, playedMs: 0 });
    tick(25_000);
    for (const s of subs) await svc.reportListen(voter, { submissionId: s.id, playedMs: 25_000 });
    return subs.map((s) => s.id) as [string, string];
  }

  beforeEach(async () => {
    clock = new Date("2026-10-16T12:00:00Z");
    await prisma.$executeRawUnsafe('TRUNCATE "users", "tracks" CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs a direct challenge from accept to a decided round", async () => {
    const { a, b, battleId } = await startedBattle();
    const fan = await user("fan");

    await svc.submitTrack(a, { battleId, roundIndex: 0, appleId: id("No Scrubs") }, catalog);
    await svc.submitTrack(b, { battleId, roundIndex: 0, appleId: id("Say My Name") }, catalog);

    const [scrubs, sayMyName] = await listenToBoth(fan, battleId, 0);
    await svc.vote(fan, sayMyName);
    expect(scrubs).toBeTruthy();

    tick(HOUR);
    await svc.advance(battleId);
    const round = await prisma.battleRound.findFirstOrThrow({ where: { battleId, index: 0 } });
    expect(round).toMatchObject({ status: "CLOSED", winnerSide: 1, outcome: "VOTES", votes0: 0, votes1: 1 });
    const next = await prisma.battleRound.findFirstOrThrow({ where: { battleId, index: 1 } });
    expect(next.status).toBe("SUBMISSIONS_OPEN");
  });

  it("only lets the invited opponent accept, and not the creator", async () => {
    const [a] = [await user("alice"), await user("bob")];
    const eve = await user("eve");
    const { id: battleId } = await svc.create(a, { theme: "Anything goes", rules, opponentHandle: "bob" });
    await expect(svc.accept(a, battleId)).rejects.toBeInstanceOf(BattleError);
    await expect(svc.accept(eve, battleId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses unverified or handle-less users", async () => {
    const a = await user("alice", { emailVerified: false });
    await expect(svc.create(a, { theme: "Anything goes", rules })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(svc.create(null, { theme: "Anything goes", rules })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires listening to both picks before voting, within wall-clock limits", async () => {
    const { a, b, battleId } = await startedBattle();
    const fan = await user("fan");
    await svc.submitTrack(a, { battleId, roundIndex: 0, appleId: id("No Scrubs") }, catalog);
    await svc.submitTrack(b, { battleId, roundIndex: 0, appleId: id("Say My Name") }, catalog);
    const subs = await prisma.submission.findMany({ where: { battleId }, orderBy: { side: "asc" } });

    await expect(svc.vote(fan, subs[0]!.id)).rejects.toMatchObject({ message: expect.stringContaining("Listen") });

    // Claiming 30 seconds two seconds after starting only credits what's plausible.
    await svc.reportListen(fan, { submissionId: subs[0]!.id, playedMs: 0 });
    tick(2_000);
    const early = await svc.reportListen(fan, { submissionId: subs[0]!.id, playedMs: 30_000 });
    expect(early.playedMs).toBeLessThanOrEqual(4_000);
    expect(early.requiredMs).toBe(20_000);

    // One track heard is not enough.
    tick(25_000);
    await svc.reportListen(fan, { submissionId: subs[0]!.id, playedMs: 25_000 });
    await expect(svc.vote(fan, subs[0]!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks battlers from voting and voters from voting twice", async () => {
    const { a, b, battleId } = await startedBattle();
    const fan = await user("fan");
    await svc.submitTrack(a, { battleId, roundIndex: 0, appleId: id("No Scrubs") }, catalog);
    await svc.submitTrack(b, { battleId, roundIndex: 0, appleId: id("Say My Name") }, catalog);

    const [left, right] = await listenToBoth(fan, battleId, 0);
    await listenToBoth(a, battleId, 0);
    await expect(svc.vote(a, right)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await svc.vote(fan, left);
    await expect(svc.vote(fan, right)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.vote.count()).toBe(1);
  });

  it("enforces the era and never repeats a track within a battle", async () => {
    const { a, b, battleId } = await startedBattle();
    await expect(
      svc.submitTrack(a, { battleId, roundIndex: 0, appleId: id("Kill Bill") }, catalog),
    ).rejects.toMatchObject({ code: "INVALID", message: expect.stringContaining("2022") });

    await svc.submitTrack(a, { battleId, roundIndex: 0, appleId: id("Yeah!") }, catalog);
    await expect(
      svc.submitTrack(b, { battleId, roundIndex: 0, appleId: id("Yeah!") }, catalog),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      svc.submitTrack(a, { battleId, roundIndex: 0, appleId: id("Burn") }, catalog),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("ignores client metadata and reuses one canonical track", async () => {
    const { a, b, battleId } = await startedBattle();
    await expect(
      svc.submitTrack(a, { battleId, roundIndex: 0, appleId: "made-up" }, catalog),
    ).rejects.toMatchObject({ code: "INVALID" });
    await svc.submitTrack(a, { battleId, roundIndex: 0, appleId: id("Foolish") }, catalog);
    await svc.submitTrack(b, { battleId, roundIndex: 0, appleId: id("Fallin'") }, catalog);
    const tracks = await prisma.track.findMany({ include: { refs: true }, orderBy: { title: "asc" } });
    expect(tracks.map((t) => t.title)).toEqual(["Fallin'", "Foolish"]);
    expect(tracks[0]!.refs[0]).toMatchObject({ provider: "APPLE_MUSIC", previewUrl: `/api/dev/tone/${id("Fallin'")}` });
  });

  it("forfeits a round to the side that picked, opens the next round late picks can't reach", async () => {
    const { a, b, battleId } = await startedBattle();
    await svc.submitTrack(a, { battleId, roundIndex: 0, appleId: id("Umbrella") }, catalog);
    tick(HOUR + 1);
    await expect(
      svc.submitTrack(b, { battleId, roundIndex: 0, appleId: id("No One") }, catalog),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // The refused late pick still committed the deadline transition.
    const rounds = await prisma.battleRound.findMany({ where: { battleId }, orderBy: { index: "asc" } });
    expect(rounds.map((r) => [r.status, r.outcome, r.winnerSide])).toEqual([
      ["CLOSED", "FORFEIT", 0],
      ["SUBMISSIONS_OPEN", null, null],
    ]);
    // Picking in the new round works (and creates no duplicate round rows).
    await svc.submitTrack(b, { battleId, roundIndex: 1, appleId: id("No One") }, catalog);
    expect(await prisma.battleRound.count({ where: { battleId } })).toBe(2);
  });

  it("sweeps due battles, finishes them, and offers one rematch", async () => {
    const { a, b, battleId } = await startedBattle();
    const fan = await user("fan");
    const picks = [
      ["No Scrubs", "Say My Name"],
      ["Crazy in Love", "Yeah!"],
      ["Umbrella", "Irreplaceable"],
    ] as const;
    for (const [i, [pa, pb]] of picks.entries()) {
      await svc.submitTrack(a, { battleId, roundIndex: i, appleId: id(pa) }, catalog);
      await svc.submitTrack(b, { battleId, roundIndex: i, appleId: id(pb) }, catalog);
      const [left] = await listenToBoth(fan, battleId, i);
      await svc.vote(fan, left);
      tick(HOUR);
      expect(await svc.advanceDue()).toBe(1);
    }

    const done = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(done).toMatchObject({ status: "COMPLETE", winnerSide: 0, nextDeadline: null });
    expect(await svc.advanceDue()).toBe(0);

    await expect(svc.rematch(fan, battleId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const re = await svc.rematch(b, battleId);
    expect(await svc.rematch(a, battleId)).toEqual(re);
    const rematch = await prisma.battle.findUniqueOrThrow({ where: { id: re.id } });
    expect(rematch).toMatchObject({ status: "PENDING_ACCEPT", creatorId: b.id, invitedUserId: a.id, rematchOfId: battleId });
  });

  it("expires challenges nobody accepts", async () => {
    const a = await user("alice");
    const { id: battleId } = await svc.create(a, { theme: "Open floor", rules });
    tick(73 * HOUR);
    expect(await svc.advanceDue()).toBe(1);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: battleId } })).status).toBe("EXPIRED");
  });
});
