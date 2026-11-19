import { DJ_BATTLE, DJ_LESSONS, camelotCompatible, djLesson, tempoCompatible } from "@vybz/core";
import { type DbHandle, eq, schema } from "@vybz/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { achievementsFor } from "../src/server/achievements";
import {
  cancelDjBattle,
  closeDueDjBattles,
  createDjBattle,
  createDjSet,
  deleteDjSet,
  djLessonStep,
  djUniversity,
  getDjBattle,
  getDjSet,
  joinDjBattle,
  listDjBattles,
  myDjSets,
  voteDjBattle,
} from "../src/server/dj";
import { TEST_DB_URL, freshDb } from "./helpers";

const battleSet = (title: string, ms = 60_000) => ({
  title,
  kind: "BATTLE",
  durationMs: ms,
  tracks: [
    { source: "VYBZ", id: "neon-drift" },
    { source: "VYBZ", id: "night-shift" },
  ],
  events: [
    { t: 0, k: "load", d: "A", v: 0 },
    { t: 0, k: "play", d: "A", v: 0 },
    { t: 20_000, k: "load", d: "B", v: 1 },
    { t: 20_100, k: "tempo", d: "B", v: 0.984 },
    { t: 21_000, k: "play", d: "B", v: 0 },
    { t: 25_000, k: "xf", v: 0 },
    { t: 30_000, k: "eq", d: "A", b: "low", v: -26 },
    { t: 40_000, k: "xf", v: 1 },
    { t: ms, k: "end" },
  ],
  stats: { transitions: 1, beatmatchPct: 92, longestSilenceMs: 0, averageBpm: 124.2 },
});

describe("harmonic and tempo rules", () => {
  it("knows which keys and tempos mix", () => {
    expect(camelotCompatible("8A", "8A")).toBe(true);
    expect(camelotCompatible("8A", "9A")).toBe(true);
    expect(camelotCompatible("12A", "1A")).toBe(true);
    expect(camelotCompatible("8A", "8B")).toBe(true);
    expect(camelotCompatible("8A", "3A")).toBe(false);
    expect(tempoCompatible(126, 124)).toBe(true);
    expect(tempoCompatible(87, 174)).toBe(true);
    expect(tempoCompatible(140, 124)).toBe(false);
  });

  it("has 11 complete lessons with shuffled quizzes", () => {
    expect(new Set(DJ_LESSONS.flatMap((l) => l.quiz.map((q) => q.answerIndex))).size).toBeGreaterThan(1);
    expect(DJ_LESSONS).toHaveLength(11);
    for (const l of DJ_LESSONS) {
      expect(l.learn.length).toBeGreaterThan(0);
      expect(l.demo.steps.length).toBeGreaterThan(0);
      expect(l.quiz).toHaveLength(3);
      for (const q of l.quiz) expect(q.answerIndex).toBeLessThan(q.choices.length);
    }
  });
});

describe.skipIf(!TEST_DB_URL)("step 8: DJ studio, university and battles", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let dj1: UserRow;
  let dj2: UserRow;
  let fan: UserRow;

  beforeAll(async () => {
    h = await freshDb();
    deps = { db: h.db, catalog: { metadata: [], playback: {}, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    [dj1, dj2, fan] = (await h.db
      .insert(schema.user)
      .values([
        { id: "u_dj1", name: "DJ One", email: "1@x.com", handle: "djone" },
        { id: "u_dj2", name: "DJ Two", email: "2@x.com", handle: "djtwo" },
        { id: "u_fan", name: "Fan", email: "f@x.com", handle: "fan" },
      ])
      .returning()) as [UserRow, UserRow, UserRow];
  });
  afterAll(() => h?.close());

  it("saves sets, keeping battle sets to the VYBZ pack and 30s–3min", async () => {
    const s = await createDjSet(deps, dj1, battleSet("Warm-up"));
    expect(s).toMatchObject({ kind: "BATTLE", vybzOnly: true, durationMs: 60_000 });
    expect(s.events).toHaveLength(9);
    const local = { ...battleSet("Mine"), kind: "SET", tracks: [{ source: "LOCAL", hash: "a".repeat(32), title: "My edit", durationMs: 200_000, bpm: 122 }, { source: "VYBZ", id: "neon-drift" }] };
    expect(await createDjSet(deps, dj1, local)).toMatchObject({ vybzOnly: false });
    await expect(createDjSet(deps, dj1, { ...local, kind: "BATTLE" })).rejects.toMatchObject({ code: "BATTLE_SET_RULES" });
    await expect(createDjSet(deps, dj1, { ...battleSet("Too short", 10_000), events: [{ t: 0, k: "load", d: "A", v: 0 }, { t: 10_000, k: "end" }] })).rejects.toMatchObject({ code: "BATTLE_SET_RULES" });
    await expect(createDjSet(deps, dj1, { ...battleSet("x"), tracks: [{ source: "APPLE_MUSIC", id: "123" }] })).rejects.toMatchObject({ code: "INVALID_SET" });
    await expect(createDjSet(deps, dj1, { ...battleSet("x"), events: [{ t: 0, k: "load", d: "A", v: 9 }] })).rejects.toMatchObject({ code: "INVALID_SET" });
    await expect(createDjSet(deps, dj1, { ...battleSet("x"), events: [{ t: 5, k: "play" }, { t: 1, k: "play" }] })).rejects.toMatchObject({ code: "INVALID_SET" });
    await expect(createDjSet(deps, null, battleSet("x"))).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
    const mine = await myDjSets(deps, dj1);
    expect(mine.items).toHaveLength(2);
    expect(mine.items[0]).not.toHaveProperty("events");
    // Private until it's in a battle.
    await expect(getDjSet(deps, fan, s.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("tracks DJ University progress and pays once when a lesson is done", async () => {
    const lesson = djLesson("beatmatching")!;
    // Beatmatching is a VYBZ Pro course.
    await h.db
      .insert(schema.subscription)
      .values({ userId: dj1.id, productId: "com.urexp.vybz.pro.monthly", originalTransactionId: "t-dj1", environment: "Sandbox", status: "ACTIVE", expiresAt: new Date(Date.now() + 86_400_000), perksFor: new Date(Date.now() + 86_400_000) });
    const uni = await djUniversity(deps, dj1);
    expect(uni).toMatchObject({ completed: 0, total: 11 });
    await djLessonStep(deps, dj1, lesson.id, { step: "learn" });
    await djLessonStep(deps, dj1, lesson.id, { step: "demo" });
    await expect(djLessonStep(deps, dj1, lesson.id, { step: "practice", check: "crossfade" })).rejects.toMatchObject({ code: "INVALID_STEP" });
    await djLessonStep(deps, dj1, lesson.id, { step: "practice", check: "beatmatch" });
    const fail = await djLessonStep(deps, dj1, lesson.id, { step: "quiz", answers: lesson.quiz.map((q) => (q.answerIndex + 1) % q.choices.length) });
    expect(fail.quiz).toMatchObject({ score: 0, passed: false });
    expect(fail.reward).toBeNull();
    const pass = await djLessonStep(deps, dj1, lesson.id, { step: "quiz", answers: lesson.quiz.map((q) => q.answerIndex) });
    expect(pass.quiz).toMatchObject({ score: 3, passed: true });
    expect(pass.progress.completed).toBe(true);
    expect(pass.reward).toEqual({ xp: lesson.xp, coins: lesson.coins });
    const again = await djLessonStep(deps, dj1, lesson.id, { step: "quiz", answers: [0, 0, 0] });
    expect(again.reward).toBeNull();
    expect(again.progress.quizScore).toBe(3);
    const ach = await achievementsFor(h.db, dj1.id);
    expect(ach.items.find((a) => a.code === "dj_first_lesson")!.unlockedAt).not.toBeNull();
    expect((await djUniversity(deps, dj1)).completed).toBe(1);
    await expect(djLessonStep(deps, dj1, "nope", { step: "learn" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("runs a DJ battle: open, taken, listened, voted, closed", async () => {
    const [s1] = (await myDjSets(deps, dj1)).items.filter((s) => s.kind === "BATTLE");
    const s2 = await createDjSet(deps, dj2, battleSet("Peak time", 90_000));
    const plain = await createDjSet(deps, dj2, { ...battleSet("Just a set"), kind: "SET" });
    await expect(createDjBattle(deps, dj2, { setId: plain.id })).rejects.toMatchObject({ code: "BATTLE_SET_RULES" });
    await expect(createDjBattle(deps, dj2, { setId: s1!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const b = await createDjBattle(deps, dj1, { setId: s1!.id, title: "Friday warm-up" });
    expect(b).toMatchObject({ status: "OPEN", b: null, canJoin: false });
    expect((await listDjBattles(deps, fan, "OPEN")).items.map((x) => x.id)).toEqual([b.id]);
    await expect(joinDjBattle(deps, dj1, b.id, { setId: s1!.id })).rejects.toMatchObject({ code: "OWN_BATTLE" });
    await expect(deleteDjSet(deps, dj1, s1!.id)).rejects.toMatchObject({ code: "SET_IN_BATTLE" });

    const on = await joinDjBattle(deps, dj2, b.id, { setId: s2.id });
    expect(on).toMatchObject({ status: "VOTING", canVote: false });
    expect(on.a.votes).toBeNull();
    const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.userId, dj1.id));
    expect(notes.map((n) => n.type)).toContain("DJ_BATTLE");
    await expect(joinDjBattle(deps, fan, b.id, { setId: s2.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Now anyone can replay both sets.
    const seen = await getDjBattle(deps, fan, b.id);
    expect(seen.a.set.events).toHaveLength(9);
    expect(seen.canVote).toBe(true);
    expect((await getDjSet(deps, fan, s2.id)).events).toBeDefined();

    await expect(voteDjBattle(deps, dj1, b.id, { side: "A", listenedMs: { A: 1e6, B: 1e6 } })).rejects.toMatchObject({ code: "OWN_BATTLE" });
    await expect(voteDjBattle(deps, fan, b.id, { side: "A", listenedMs: { A: 60_000, B: 10_000 } })).rejects.toMatchObject({ code: "LISTEN_FIRST" });
    const voted = await voteDjBattle(deps, fan, b.id, { side: "B", listenedMs: { A: 60_000, B: 90_000 } });
    expect(voted.myVote).toBe("B");

    // Time's up.
    await h.db.update(schema.djBattle).set({ votingEndsAt: new Date(Date.now() - 1000) }).where(eq(schema.djBattle.id, b.id));
    expect(await closeDueDjBattles(deps)).toBe(1);
    const done = await getDjBattle(deps, fan, b.id);
    expect(done).toMatchObject({ status: "COMPLETE", winner: "B", canVote: false });
    expect(done.b!.votes).toBe(1);
    const ledger = await h.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.reason, "DJ_BATTLE"));
    expect(ledger.find((l) => l.userId === dj2.id && l.ref.endsWith(":win"))!.xp).toBe(DJ_BATTLE.winXp);
    expect(ledger.filter((l) => l.ref.endsWith(":play"))).toHaveLength(2);
    expect((await achievementsFor(h.db, dj2.id)).items.find((a) => a.code === "dj_battle_win")!.unlockedAt).not.toBeNull();
    await expect(voteDjBattle(deps, fan, b.id, { side: "A", listenedMs: { A: 1e6, B: 1e6 } })).rejects.toMatchObject({ code: "VOTING_CLOSED" });
    expect(await closeDueDjBattles(deps)).toBe(0);
  });

  it("lets a DJ cancel an open battle", async () => {
    const s = await createDjSet(deps, dj1, battleSet("Another"));
    const b = await createDjBattle(deps, dj1, { setId: s.id });
    await expect(cancelDjBattle(deps, dj2, b.id)).rejects.toMatchObject({ code: "CANT_CANCEL" });
    await cancelDjBattle(deps, dj1, b.id);
    await expect(getDjBattle(deps, dj1, b.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await deleteDjSet(deps, dj1, s.id)).toEqual({ ok: true });
  });
});
