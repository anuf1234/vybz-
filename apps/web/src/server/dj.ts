import {
  DJ_BATTLE,
  DJ_LESSONS,
  DJ_LIMITS,
  DJ_QUIZ_PASS,
  type DjBattleView,
  type DjEvent,
  type DjLessonProgress,
  type DjLessonStepResult,
  type DjSetInput,
  type DjSetStats,
  type DjSetView,
  type DjTrackRef,
  type DjUniversityResponse,
  djLesson,
  packTrack,
} from "@vybz/core";
import { type Database, type Executor, and, desc, eq, inArray, isNull, lte, newId, or, schema, sql } from "@vybz/db";
import { checkAchievements } from "./achievements";
import { type BattleDeps, ServiceError, type UserRow, usersById } from "./battles/service";
import { createNotifications } from "./notifications";
import { grant, systemIds } from "./progression";

/**
 * DJ Vybz Studio sets, DJ University progress and DJ battles. Sets store the
 * tracks used and every move, never audio: the studio replays them. Device
 * files are referenced by hash only and never uploaded.
 */

type SetRow = typeof schema.djSet.$inferSelect;
type BattleRow = typeof schema.djBattle.$inferSelect;

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  return user;
}

// ── Validation ─────────────────────────────────────────────────────────────

const EVENT_KINDS = new Set(["load", "play", "pause", "seek", "cue", "setcue", "tempo", "vol", "eq", "filter", "xf", "end"]);
const finite = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function parseTracks(raw: unknown): DjTrackRef[] {
  if (!Array.isArray(raw) || raw.length > DJ_LIMITS.maxTracks) throw new ServiceError(400, "INVALID_SET", "A set can use up to 20 tracks.");
  return raw.map((t) => {
    const r = (t ?? {}) as Record<string, unknown>;
    if (r.source === "VYBZ" && typeof r.id === "string" && packTrack(r.id)) return { source: "VYBZ", id: r.id };
    if (r.source === "LOCAL" && typeof r.hash === "string" && /^[a-f0-9]{16,64}$/.test(r.hash) && typeof r.title === "string" && finite(r.durationMs, 1000, 4 * 3600_000)) {
      return {
        source: "LOCAL",
        hash: r.hash,
        title: r.title.trim().slice(0, 120) || "Untitled",
        durationMs: Math.round(r.durationMs as number),
        bpm: finite(r.bpm, 40, 250) ? Math.round((r.bpm as number) * 100) / 100 : null,
      };
    }
    throw new ServiceError(400, "INVALID_SET", "One of the tracks isn't something the studio can play.");
  });
}

function parseEvents(raw: unknown, tracks: number, durationMs: number): DjEvent[] {
  if (!Array.isArray(raw) || raw.length > DJ_LIMITS.maxEvents) throw new ServiceError(400, "INVALID_SET", "That set has too many moves to save.");
  let last = 0;
  return raw.map((e) => {
    const r = (e ?? {}) as Record<string, unknown>;
    if (!finite(r.t, 0, durationMs + 1000) || (r.t as number) < last || !EVENT_KINDS.has(String(r.k))) throw new ServiceError(400, "INVALID_SET");
    last = r.t as number;
    const ev: DjEvent = { t: Math.round(r.t as number), k: r.k as DjEvent["k"] };
    if (r.d !== undefined) {
      if (r.d !== "A" && r.d !== "B") throw new ServiceError(400, "INVALID_SET");
      ev.d = r.d;
    }
    if (r.v !== undefined) {
      if (!finite(r.v, -1e7, 1e7)) throw new ServiceError(400, "INVALID_SET");
      ev.v = r.v as number;
    }
    if (r.b !== undefined) {
      if (!["low", "mid", "high"].includes(String(r.b))) throw new ServiceError(400, "INVALID_SET");
      ev.b = r.b as DjEvent["b"];
    }
    if (ev.k === "load" && (!Number.isInteger(ev.v) || ev.v! < 0 || ev.v! >= tracks)) throw new ServiceError(400, "INVALID_SET");
    return ev;
  });
}

function parseStats(raw: unknown): DjSetStats {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    transitions: finite(r.transitions, 0, 1000) ? Math.round(r.transitions as number) : 0,
    beatmatchPct: finite(r.beatmatchPct, 0, 100) ? Math.round(r.beatmatchPct as number) : null,
    longestSilenceMs: finite(r.longestSilenceMs, 0, DJ_LIMITS.maxSetMs) ? Math.round(r.longestSilenceMs as number) : 0,
    averageBpm: finite(r.averageBpm, 40, 250) ? Math.round((r.averageBpm as number) * 10) / 10 : null,
  };
}

export function parseSetInput(body: unknown): DjSetInput & { vybzOnly: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = String(b.title ?? "").trim().slice(0, DJ_LIMITS.titleMax);
  if (!title) throw new ServiceError(400, "INVALID_SET", "Give your set a name.");
  const kind = b.kind === "BATTLE" ? "BATTLE" : b.kind === "SET" || b.kind === undefined ? "SET" : null;
  if (!kind) throw new ServiceError(400, "INVALID_SET");
  if (!finite(b.durationMs, 1000, DJ_LIMITS.maxSetMs)) throw new ServiceError(400, "INVALID_SET", "Sets can be up to an hour.");
  const durationMs = Math.round(b.durationMs as number);
  const tracks = parseTracks(b.tracks);
  if (!tracks.length) throw new ServiceError(400, "INVALID_SET", "Play at least one track.");
  const events = parseEvents(b.events, tracks.length, durationMs);
  const vybzOnly = tracks.every((t) => t.source === "VYBZ");
  if (kind === "BATTLE") {
    if (!vybzOnly) throw new ServiceError(400, "BATTLE_SET_RULES", "Battle sets use VYBZ pack tracks only, so every listener can hear them.");
    if (durationMs < DJ_LIMITS.battleMinMs || durationMs > DJ_LIMITS.battleMaxMs) throw new ServiceError(400, "BATTLE_SET_RULES", "Battle sets run 30 seconds to 3 minutes.");
  }
  return { title, kind, tracks, events, durationMs, stats: parseStats(b.stats), vybzOnly };
}

// ── Sets ───────────────────────────────────────────────────────────────────

async function setViews(db: Executor, rows: SetRow[], withEvents: (r: SetRow) => boolean): Promise<DjSetView[]> {
  const users = await usersById(db, [...new Set(rows.map((r) => r.ownerId))]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    owner: users.get(r.ownerId) ?? { id: r.ownerId, handle: "unknown", displayName: "Unknown", image: null },
    tracks: r.tracks as DjTrackRef[],
    vybzOnly: r.vybzOnly,
    durationMs: r.durationMs,
    stats: r.stats as DjSetStats,
    createdAt: r.createdAt.toISOString(),
    ...(withEvents(r) ? { events: r.events as DjEvent[] } : {}),
  }));
}

export async function createDjSet(deps: BattleDeps, viewer: UserRow | null, body: unknown): Promise<DjSetView> {
  const user = requireUser(viewer);
  const input = parseSetInput(body);
  const [{ n }] = (await deps.db.select({ n: sql<number>`count(*)::int` }).from(schema.djSet).where(eq(schema.djSet.ownerId, user.id))) as [{ n: number }];
  if (n >= 200) throw new ServiceError(409, "TOO_MANY_SETS", "You have 200 saved sets. Delete some to save more.");
  const [row] = await deps.db
    .insert(schema.djSet)
    .values({ id: newId(), ownerId: user.id, ...input })
    .returning();
  return (await setViews(deps.db, [row!], () => true))[0]!;
}

export async function myDjSets(deps: BattleDeps, viewer: UserRow | null): Promise<{ items: DjSetView[] }> {
  const user = requireUser(viewer);
  const rows = await deps.db.select().from(schema.djSet).where(eq(schema.djSet.ownerId, user.id)).orderBy(desc(schema.djSet.createdAt)).limit(200);
  return { items: await setViews(deps.db, rows, () => false) };
}

/** Owners see their sets; anyone can see (and replay) a set entered into a DJ battle that's past the open stage. */
export async function getDjSet(deps: BattleDeps, viewer: UserRow | null, id: string): Promise<DjSetView> {
  const [row] = await deps.db.select().from(schema.djSet).where(eq(schema.djSet.id, id));
  if (!row) throw new ServiceError(404, "NOT_FOUND");
  if (row.ownerId !== viewer?.id) {
    const [inBattle] = await deps.db
      .select({ id: schema.djBattle.id })
      .from(schema.djBattle)
      .where(and(or(eq(schema.djBattle.creatorSetId, id), eq(schema.djBattle.opponentSetId, id)), inArray(schema.djBattle.status, ["VOTING", "COMPLETE"])))
      .limit(1);
    if (!inBattle) throw new ServiceError(404, "NOT_FOUND");
  }
  return (await setViews(deps.db, [row], () => true))[0]!;
}

export async function renameDjSet(deps: BattleDeps, viewer: UserRow | null, id: string, body: unknown): Promise<DjSetView> {
  const user = requireUser(viewer);
  const title = String((body as { title?: unknown } | null)?.title ?? "").trim().slice(0, DJ_LIMITS.titleMax);
  if (!title) throw new ServiceError(400, "INVALID_SET", "Give your set a name.");
  const [row] = await deps.db.update(schema.djSet).set({ title }).where(and(eq(schema.djSet.id, id), eq(schema.djSet.ownerId, user.id))).returning();
  if (!row) throw new ServiceError(404, "NOT_FOUND");
  return (await setViews(deps.db, [row], () => true))[0]!;
}

export async function deleteDjSet(deps: BattleDeps, viewer: UserRow | null, id: string): Promise<{ ok: true }> {
  const user = requireUser(viewer);
  const [busy] = await deps.db
    .select({ id: schema.djBattle.id })
    .from(schema.djBattle)
    .where(and(or(eq(schema.djBattle.creatorSetId, id), eq(schema.djBattle.opponentSetId, id)), inArray(schema.djBattle.status, ["OPEN", "VOTING"])))
    .limit(1);
  if (busy) throw new ServiceError(409, "SET_IN_BATTLE", "That set is in a DJ battle that hasn't finished.");
  const rows = await deps.db.delete(schema.djSet).where(and(eq(schema.djSet.id, id), eq(schema.djSet.ownerId, user.id))).returning({ id: schema.djSet.id });
  if (!rows.length) throw new ServiceError(404, "NOT_FOUND");
  return { ok: true };
}

// ── DJ University ──────────────────────────────────────────────────────────

type ProgressRow = typeof schema.djLessonProgress.$inferSelect;

function progressOf(r: ProgressRow | undefined): DjLessonProgress {
  return {
    learned: !!r?.learnedAt,
    watched: !!r?.watchedAt,
    practiced: !!r?.practicedAt,
    quizScore: r?.quizScore ?? null,
    completed: !!r?.completedAt,
  };
}

export async function djUniversity(deps: BattleDeps, viewer: UserRow | null): Promise<DjUniversityResponse> {
  const user = requireUser(viewer);
  const rows = await deps.db.select().from(schema.djLessonProgress).where(eq(schema.djLessonProgress.userId, user.id));
  const by = new Map(rows.map((r) => [r.lessonId, r]));
  const lessons = [...DJ_LESSONS]
    .sort((a, b) => a.order - b.order)
    .map((l) => ({ id: l.id, course: l.course, order: l.order, title: l.title, icon: l.icon, summary: l.summary, xp: l.xp, coins: l.coins, progress: progressOf(by.get(l.id)) }));
  return { lessons, completed: lessons.filter((l) => l.progress.completed).length, total: lessons.length };
}

/** Marks a step done; the lesson completes (and pays once) when all four are done and the quiz is passed. */
export async function djLessonStep(deps: BattleDeps, viewer: UserRow | null, lessonId: string, body: unknown): Promise<DjLessonStepResult> {
  const user = requireUser(viewer);
  const lesson = djLesson(lessonId);
  if (!lesson) throw new ServiceError(404, "NOT_FOUND");
  const b = (body ?? {}) as { step?: unknown; answers?: unknown; check?: unknown };
  const now = new Date();
  const set: Partial<typeof schema.djLessonProgress.$inferInsert> = {};
  let quiz: DjLessonStepResult["quiz"];
  switch (b.step) {
    case "learn":
      set.learnedAt = now;
      break;
    case "demo":
      set.watchedAt = now;
      break;
    case "practice":
      if (b.check !== lesson.practice.check.type) throw new ServiceError(400, "INVALID_STEP", "That practice result is for a different exercise.");
      set.practicedAt = now;
      break;
    case "quiz": {
      const answers = Array.isArray(b.answers) ? b.answers : [];
      if (answers.length !== lesson.quiz.length) throw new ServiceError(400, "INVALID_STEP", "Answer every question.");
      const graded = lesson.quiz.map((q, i) => ({ correct: Number(answers[i]) === q.answerIndex, answerIndex: q.answerIndex, explanation: q.explanation }));
      const score = graded.filter((g) => g.correct).length;
      quiz = { score, total: lesson.quiz.length, passed: score >= DJ_QUIZ_PASS, answers: graded };
      set.quizScore = score;
      break;
    }
    default:
      throw new ServiceError(400, "INVALID_STEP");
  }
  const t = schema.djLessonProgress;
  const [row] = await deps.db
    .insert(t)
    .values({ userId: user.id, lessonId, ...set })
    .onConflictDoUpdate({
      target: [t.userId, t.lessonId],
      // A retaken quiz keeps your best score.
      set: set.quizScore !== undefined ? { quizScore: sql`greatest(coalesce(${t.quizScore}, 0), ${set.quizScore})` } : set,
    })
    .returning();
  let progress = progressOf(row);
  let reward: DjLessonStepResult["reward"] = null;
  const ready = progress.learned && progress.watched && progress.practiced && (progress.quizScore ?? 0) >= DJ_QUIZ_PASS;
  if (ready && !row!.completedAt) {
    const [done] = await deps.db
      .update(t)
      .set({ completedAt: now })
      .where(and(eq(t.userId, user.id), eq(t.lessonId, lessonId), isNull(t.completedAt)))
      .returning();
    if (done) {
      progress = progressOf(done);
      if (!(await systemIds(deps.db, [user.id])).size) {
        await grant(deps.db, user.id, "DJ_LESSON", lessonId, { xp: lesson.xp, coins: lesson.coins });
        reward = { xp: lesson.xp, coins: lesson.coins };
        await checkAchievements(deps.db, deps.push, [user.id]);
      }
    }
  }
  return { progress, reward, ...(quiz ? { quiz } : {}) };
}

// ── DJ battles ─────────────────────────────────────────────────────────────

async function ownBattleSet(db: Executor, user: UserRow, setId: unknown): Promise<SetRow> {
  if (typeof setId !== "string") throw new ServiceError(400, "SET_REQUIRED", "Pick one of your battle sets.");
  const [set] = await db.select().from(schema.djSet).where(eq(schema.djSet.id, setId));
  if (!set || set.ownerId !== user.id) throw new ServiceError(404, "NOT_FOUND");
  if (set.kind !== "BATTLE" || !set.vybzOnly || set.durationMs < DJ_LIMITS.battleMinMs || set.durationMs > DJ_LIMITS.battleMaxMs) {
    throw new ServiceError(400, "BATTLE_SET_RULES", "Enter a battle set: 30 seconds to 3 minutes, VYBZ pack tracks only.");
  }
  return set;
}

export async function createDjBattle(deps: BattleDeps, viewer: UserRow | null, body: unknown): Promise<DjBattleView> {
  const user = requireUser(viewer);
  const b = (body ?? {}) as { setId?: unknown; title?: unknown };
  const set = await ownBattleSet(deps.db, user, b.setId);
  const title = String(b.title ?? "").trim().slice(0, DJ_LIMITS.titleMax) || `${set.title}: DJ battle`;
  const [open] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.djBattle)
    .where(and(eq(schema.djBattle.creatorId, user.id), eq(schema.djBattle.status, "OPEN")));
  if ((open?.n ?? 0) >= 3) throw new ServiceError(409, "TOO_MANY_OPEN", "You already have 3 open DJ battles waiting for an opponent.");
  const [row] = await deps.db.insert(schema.djBattle).values({ id: newId(), title, creatorId: user.id, creatorSetId: set.id }).returning();
  return djBattleView(deps, user, row!);
}

export async function joinDjBattle(deps: BattleDeps, viewer: UserRow | null, id: string, body: unknown): Promise<DjBattleView> {
  const user = requireUser(viewer);
  const set = await ownBattleSet(deps.db, user, (body as { setId?: unknown } | null)?.setId);
  const endsAt = new Date(Date.now() + DJ_BATTLE.votingMs);
  const [row] = await deps.db
    .update(schema.djBattle)
    .set({ opponentId: user.id, opponentSetId: set.id, status: "VOTING", votingEndsAt: endsAt })
    .where(and(eq(schema.djBattle.id, id), eq(schema.djBattle.status, "OPEN"), sql`${schema.djBattle.creatorId} <> ${user.id}`))
    .returning();
  if (!row) {
    const [exists] = await deps.db.select().from(schema.djBattle).where(eq(schema.djBattle.id, id));
    if (!exists) throw new ServiceError(404, "NOT_FOUND");
    if (exists.creatorId === user.id) throw new ServiceError(409, "OWN_BATTLE", "You can't take your own battle.");
    throw new ServiceError(409, "ALREADY_TAKEN", "Someone already took this battle.");
  }
  await createNotifications(deps.db, deps.push, [
    { userId: row.creatorId, type: "DJ_BATTLE", title: "🎚️ Your DJ battle is on", body: `@${user.handle} took your battle. Voting is open for 24 hours.`, battleId: null, link: `/dj/battle/${id}` },
  ]);
  return djBattleView(deps, user, row);
}

export async function cancelDjBattle(deps: BattleDeps, viewer: UserRow | null, id: string): Promise<{ ok: true }> {
  const user = requireUser(viewer);
  const rows = await deps.db
    .update(schema.djBattle)
    .set({ status: "CANCELLED" })
    .where(and(eq(schema.djBattle.id, id), eq(schema.djBattle.creatorId, user.id), eq(schema.djBattle.status, "OPEN")))
    .returning({ id: schema.djBattle.id });
  if (!rows.length) throw new ServiceError(409, "CANT_CANCEL", "Only an open battle you started can be cancelled.");
  return { ok: true };
}

export async function voteDjBattle(deps: BattleDeps, viewer: UserRow | null, id: string, body: unknown): Promise<DjBattleView> {
  const user = requireUser(viewer);
  const b = (body ?? {}) as { side?: unknown; listenedMs?: { A?: unknown; B?: unknown } };
  if (b.side !== "A" && b.side !== "B") throw new ServiceError(400, "INVALID_VOTE");
  await closeDueDjBattles(deps);
  const [row] = await deps.db.select().from(schema.djBattle).where(eq(schema.djBattle.id, id));
  if (!row) throw new ServiceError(404, "NOT_FOUND");
  if (row.status !== "VOTING") throw new ServiceError(409, "VOTING_CLOSED", "Voting isn't open for this battle.");
  if (row.creatorId === user.id || row.opponentId === user.id) throw new ServiceError(403, "OWN_BATTLE", "You can't vote in your own battle.");
  const sets = await deps.db.select({ id: schema.djSet.id, ms: schema.djSet.durationMs }).from(schema.djSet).where(inArray(schema.djSet.id, [row.creatorSetId, row.opponentSetId!]));
  const need = (setId: string) => (sets.find((s) => s.id === setId)?.ms ?? 0) * DJ_BATTLE.listenShare;
  const heard = (v: unknown) => (finite(v, 0, 1e9) ? (v as number) : 0);
  if (heard(b.listenedMs?.A) < need(row.creatorSetId) || heard(b.listenedMs?.B) < need(row.opponentSetId!)) {
    throw new ServiceError(409, "LISTEN_FIRST", "Listen to both sets before you vote.");
  }
  await deps.db
    .insert(schema.djBattleVote)
    .values({ battleId: id, voterId: user.id, side: b.side })
    .onConflictDoUpdate({ target: [schema.djBattleVote.battleId, schema.djBattleVote.voterId], set: { side: b.side, createdAt: new Date() } });
  return djBattleView(deps, user, row);
}

/** Closes battles whose voting time is up: most votes wins, both DJs earn XP. Runs from the scheduler and on reads. */
export async function closeDueDjBattles(deps: Pick<BattleDeps, "db" | "push">, now = new Date()): Promise<number> {
  const due = await deps.db
    .select()
    .from(schema.djBattle)
    .where(and(eq(schema.djBattle.status, "VOTING"), lte(schema.djBattle.votingEndsAt, now)))
    .limit(50);
  let closed = 0;
  for (const b of due) {
    const tally = await deps.db
      .select({ side: schema.djBattleVote.side, n: sql<number>`count(*)::int` })
      .from(schema.djBattleVote)
      .where(eq(schema.djBattleVote.battleId, b.id))
      .groupBy(schema.djBattleVote.side);
    const a = tally.find((t) => t.side === "A")?.n ?? 0;
    const bb = tally.find((t) => t.side === "B")?.n ?? 0;
    const winnerId = a > bb ? b.creatorId : bb > a ? b.opponentId : null;
    const [row] = await deps.db
      .update(schema.djBattle)
      .set({ status: "COMPLETE", winnerId })
      .where(and(eq(schema.djBattle.id, b.id), eq(schema.djBattle.status, "VOTING")))
      .returning();
    if (!row) continue;
    closed++;
    const djs = [b.creatorId, b.opponentId!];
    const system = await systemIds(deps.db, djs);
    for (const dj of djs) {
      if (system.has(dj)) continue;
      await grant(deps.db, dj, "DJ_BATTLE", `${b.id}:play`, { xp: DJ_BATTLE.playXp, coins: 0 });
      if (dj === winnerId) await grant(deps.db, dj, "DJ_BATTLE", `${b.id}:win`, { xp: DJ_BATTLE.winXp, coins: DJ_BATTLE.winCoins });
    }
    await createNotifications(
      deps.db,
      deps.push,
      djs.map((dj) => ({
        userId: dj,
        type: "DJ_BATTLE" as const,
        title: winnerId === dj ? "🏆 You won your DJ battle" : winnerId ? "🎚️ DJ battle result" : "🎚️ DJ battle drawn",
        body: `${b.title}: ${a}–${bb}.`,
        battleId: null,
        link: `/dj/battle/${b.id}`,
      })),
    );
    await checkAchievements(deps.db as Database, deps.push, djs);
  }
  return closed;
}

async function djBattleView(deps: BattleDeps, viewer: UserRow | null, row: BattleRow): Promise<DjBattleView> {
  const setIds = [row.creatorSetId, ...(row.opponentSetId ? [row.opponentSetId] : [])];
  const sets = await deps.db.select().from(schema.djSet).where(inArray(schema.djSet.id, setIds));
  // Sets are heard once voting opens; before that only the owner can replay theirs.
  const views = await setViews(deps.db, sets, (s) => row.status === "VOTING" || row.status === "COMPLETE" || s.ownerId === viewer?.id);
  const byId = new Map(views.map((v) => [v.id, v]));
  const tally = await deps.db
    .select({ side: schema.djBattleVote.side, n: sql<number>`count(*)::int` })
    .from(schema.djBattleVote)
    .where(eq(schema.djBattleVote.battleId, row.id))
    .groupBy(schema.djBattleVote.side);
  const [mine] = viewer ? await deps.db.select().from(schema.djBattleVote).where(and(eq(schema.djBattleVote.battleId, row.id), eq(schema.djBattleVote.voterId, viewer.id))) : [];
  // Counts stay hidden until the battle ends, so early votes don't sway later ones.
  const shown = row.status === "COMPLETE";
  const votes = (side: "A" | "B") => (shown ? (tally.find((t) => t.side === side)?.n ?? 0) : null);
  const isDj = viewer && (viewer.id === row.creatorId || viewer.id === row.opponentId);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    a: { dj: byId.get(row.creatorSetId)!.owner, set: byId.get(row.creatorSetId)!, votes: votes("A") },
    b: row.opponentSetId ? { dj: byId.get(row.opponentSetId)!.owner, set: byId.get(row.opponentSetId)!, votes: votes("B") } : null,
    votingEndsAt: row.votingEndsAt?.toISOString() ?? null,
    winner: row.status !== "COMPLETE" ? null : row.winnerId === row.creatorId ? "A" : row.winnerId && row.winnerId === row.opponentId ? "B" : "DRAW",
    myVote: (mine?.side as "A" | "B" | undefined) ?? null,
    canJoin: row.status === "OPEN" && !!viewer && viewer.id !== row.creatorId,
    canVote: row.status === "VOTING" && !!viewer && !isDj,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getDjBattle(deps: BattleDeps, viewer: UserRow | null, id: string): Promise<DjBattleView> {
  await closeDueDjBattles(deps);
  const [row] = await deps.db.select().from(schema.djBattle).where(eq(schema.djBattle.id, id));
  if (!row || row.status === "CANCELLED") throw new ServiceError(404, "NOT_FOUND");
  return djBattleView(deps, viewer, row);
}

export async function listDjBattles(deps: BattleDeps, viewer: UserRow | null, status: string | null): Promise<{ items: DjBattleView[] }> {
  await closeDueDjBattles(deps);
  const st = status === "OPEN" || status === "COMPLETE" ? status : "VOTING";
  const rows = await deps.db.select().from(schema.djBattle).where(eq(schema.djBattle.status, st)).orderBy(desc(schema.djBattle.createdAt)).limit(30);
  const items = [];
  for (const r of rows) {
    const v = await djBattleView(deps, viewer, r);
    // Lists don't carry the move logs.
    items.push({ ...v, a: { ...v.a, set: { ...v.a.set, events: undefined } }, b: v.b ? { ...v.b, set: { ...v.b.set, events: undefined } } : null });
  }
  return { items };
}
