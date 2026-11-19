import { recordActivity } from "./vybz-streak";
import {
  GENRE_KEYS,
  TRIVIA,
  TRIVIA_CATEGORIES,
  TRIVIA_CATEGORY_INFO,
  type TriviaAdminList,
  type TriviaAdminQuestion,
  type TriviaAnswerResult,
  type TriviaCategory,
  type TriviaHubResponse,
  type TriviaLeaderRow,
  type TriviaLeaderboardPeriod,
  type TriviaLeaderboardResponse,
  type TriviaMode,
  type TriviaPlayView,
  type TriviaQuestionInput,
  type TriviaQuestionStatus,
  type TriviaQuestionView,
  type TriviaResult,
  type TriviaReviewItem,
  achievementDef,
  lyricsProblem,
  triviaMaxScore,
  triviaPoints,
  triviaReward,
} from "@vybz/core";
import { type Database, type Executor, type SQL, and, desc, eq, gte, inArray, isNotNull, isNull, lte, newId, notInArray, or, schema, sql } from "@vybz/db";
import { checkAchievements } from "./achievements";
import { type BattleDeps, ServiceError, type UserRow, usersById } from "./battles/service";
import { isStaff } from "./battles/access";
import { grant, localDay, shiftDay, systemIds, validTimeZone } from "./progression";
import { TRIVIA_BANK } from "./trivia-bank";

/**
 * Music trivia: a shared daily 10-question challenge and category practice.
 * Answers stay on the server; each question is checked against a clock that
 * starts when it's shown, so looking things up costs you the speed bonus and,
 * past the limit, the point.
 */

export interface TriviaOptions {
  /** Guess the song may play official provider previews (or the demo catalog's own audio). */
  audioPreviews: boolean;
}

type QuestionRow = typeof schema.triviaQuestion.$inferSelect;
type PlayRow = typeof schema.triviaPlay.$inferSelect;
type SetRow = typeof schema.triviaSet.$inferSelect;
interface StoredAnswer {
  questionId: string;
  choice: number | null;
  correct: boolean;
  points: number;
  ms: number;
}

const answersOf = (p: PlayRow) => (p.answers as StoredAnswer[]) ?? [];

// ── Question bank ──────────────────────────────────────────────────────────

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic shuffle (seeded), so the seed bank loads the same everywhere. */
function seededOrder<T>(items: T[], seed: string): T[] {
  return items
    .map((x, i) => ({ x, k: hash(`${seed}:${i}`) }))
    .sort((a, b) => a.k - b.k)
    .map((e) => e.x);
}

function shuffled<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const loaded = new WeakMap<object, Promise<void>>();

/** Loads the starter bank once per process and database (new entries are added; staff edits are kept). */
export function ensureTriviaBank(db: Database): Promise<void> {
  let p = loaded.get(db);
  if (!p) {
    p = loadBank(db).then(
      () => undefined,
      (err) => {
        loaded.delete(db);
        throw err;
      },
    );
    loaded.set(db, p);
  }
  return p;
}

export async function loadBank(db: Executor): Promise<number> {
  const rows = TRIVIA_BANK.map(([category, genre, difficulty, prompt, answer, wrong, explanation]) => {
    const choices = seededOrder([answer, ...wrong], prompt);
    return {
      id: newId(),
      category,
      genre,
      difficulty,
      prompt,
      choices,
      answerIndex: choices.indexOf(answer),
      explanation,
      source: "SEED" as const,
      status: "APPROVED" as const,
      dedupeKey: `seed:${hash(prompt).toString(36)}`,
    };
  });
  const inserted = await db.insert(schema.triviaQuestion).values(rows).onConflictDoNothing().returning({ id: schema.triviaQuestion.id });
  return inserted.length;
}

function cleanAlbum(name: string | null): string | null {
  const n = name?.replace(/\s+-\s+(Single|EP)$/i, "").trim();
  return n ? n : null;
}

/**
 * Questions built from catalog metadata: album art, "who released…", Guess
 * the song (served only when previews are allowed) and release years (left
 * as drafts, since compilations and reissues can carry the wrong year).
 * Artwork and audio stay on the provider's servers.
 */
export async function generateCatalogQuestions(db: Executor, limit = 40): Promise<number> {
  const t = schema.track;
  const tracks = await db
    .select({ id: t.id, title: t.title, artist: t.artistName, album: t.albumName, year: t.releaseYear, art: t.artworkUrl, genres: t.genres })
    .from(t)
    .orderBy(sql`random()`)
    .limit(400);
  if (tracks.length < 4) return 0;
  const withPreview = new Set(
    (
      await db
        .select({ id: schema.trackProviderRef.trackId })
        .from(schema.trackProviderRef)
        .where(and(inArray(schema.trackProviderRef.trackId, tracks.map((x) => x.id)), isNotNull(schema.trackProviderRef.previewUrl)))
    ).map((r) => r.id),
  );
  const genreOf = (gs: string[]) => {
    const lower = gs.map((x) => x.toLowerCase());
    for (const key of GENRE_KEYS) if (lower.some((x) => x.includes(key === "hiphop" ? "hip" : key === "rnb" ? "r&b" : key))) return key;
    return null;
  };
  const others = <T>(pool: T[], not: T, n = 3) => shuffled([...new Set(pool.filter((x) => x !== not))]).slice(0, n);
  const albums = [...new Set(tracks.map((x) => cleanAlbum(x.album)).filter((x): x is string => !!x))];
  const artists = [...new Set(tracks.map((x) => x.artist))];
  const titles = [...new Set(tracks.map((x) => x.title))];
  const rows: (typeof schema.triviaQuestion.$inferInsert)[] = [];
  const add = (key: string, trackId: string, category: TriviaCategory, status: "APPROVED" | "DRAFT", prompt: string, answer: string, wrong: string[], genre: string | null, explanation: string) => {
    if (wrong.length < 3) return;
    const choices = shuffled([answer, ...wrong]);
    rows.push({ id: newId(), category, genre, difficulty: 2, prompt, choices, answerIndex: choices.indexOf(answer), explanation, trackId, source: "CATALOG", status, dedupeKey: key });
  };
  for (const tr of tracks) {
    if (rows.length >= limit) break;
    const genre = genreOf(tr.genres);
    const album = cleanAlbum(tr.album);
    if (tr.art && album && albums.length >= 4) {
      add(`cat:art:${tr.id}`, tr.id, "ALBUM_ART", "APPROVED", "Which release is this cover art from?", album, others(albums, album), genre, `That's the cover of ${album} by ${tr.artist}.`);
    }
    if (artists.length >= 4) {
      add(`cat:artist:${tr.id}`, tr.id, "ARTIST", "APPROVED", `Who released "${tr.title}"?`, tr.artist, others(artists, tr.artist), genre, `"${tr.title}" is by ${tr.artist}.`);
    }
    if (withPreview.has(tr.id) && titles.length >= 4) {
      add(`cat:song:${tr.id}`, tr.id, "GUESS_SONG", "APPROVED", "Name this song.", tr.title, others(titles, tr.title), genre, `That was "${tr.title}" by ${tr.artist}.`);
    }
    if (tr.year && tr.year > 1900) {
      const wrong = shuffled([-6, -3, -2, 2, 3, 6].map((d) => String(tr.year! + d))).slice(0, 3);
      add(`cat:year:${tr.id}`, tr.id, "HISTORY", "DRAFT", `"${tr.title}" by ${tr.artist} came out in which year?`, String(tr.year), wrong, genre, `Released in ${tr.year}.`);
    }
  }
  if (!rows.length) return 0;
  const inserted = await db.insert(schema.triviaQuestion).values(rows).onConflictDoNothing().returning({ id: schema.triviaQuestion.id });
  return inserted.length;
}

// ── Sets ───────────────────────────────────────────────────────────────────

function servable(opts: TriviaOptions): SQL {
  const q = schema.triviaQuestion;
  return opts.audioPreviews ? eq(q.status, "APPROVED") : and(eq(q.status, "APPROVED"), sql`${q.category} <> 'GUESS_SONG'`)!;
}

/** Daily mix: 2 history, 3 artist, 3 genre, 1 album art, 1 guess the song; gaps filled from anything. Easy first. */
const DAILY_MIX: [TriviaCategory, number][] = [
  ["HISTORY", 2],
  ["ARTIST", 3],
  ["GENRE", 3],
  ["ALBUM_ART", 1],
  ["GUESS_SONG", 1],
];

async function buildDailySet(deps: BattleDeps, opts: TriviaOptions, day: string): Promise<SetRow> {
  const db = deps.db;
  const [existing] = await db.select().from(schema.triviaSet).where(and(eq(schema.triviaSet.mode, "DAILY"), eq(schema.triviaSet.day, day)));
  if (existing) return existing;
  await ensureTriviaBank(db);
  const q = schema.triviaQuestion;
  const recent = await db
    .select({ ids: schema.triviaSet.questionIds })
    .from(schema.triviaSet)
    .where(and(eq(schema.triviaSet.mode, "DAILY"), gte(schema.triviaSet.day, shiftDay(day, -45)), lte(schema.triviaSet.day, day)));
  const used = [...new Set(recent.flatMap((r) => r.ids))];
  const pick = async (cat: TriviaCategory | null, n: number, exclude: string[], fresh: boolean) => {
    if (n <= 0) return [] as QuestionRow[];
    const conds: SQL[] = [servable(opts)];
    if (cat) conds.push(eq(q.category, cat));
    const skip = fresh ? [...exclude, ...used] : exclude;
    if (skip.length) conds.push(notInArray(q.id, skip));
    return db.select().from(q).where(and(...conds)).orderBy(sql`random()`).limit(n);
  };
  let chosen: QuestionRow[] = [];
  for (const [cat, n] of DAILY_MIX) chosen.push(...(await pick(cat, n, chosen.map((c) => c.id), true)));
  if (chosen.length < TRIVIA.questions) chosen.push(...(await pick(null, TRIVIA.questions - chosen.length, chosen.map((c) => c.id), true)));
  if (chosen.length < TRIVIA.questions) chosen.push(...(await pick(null, TRIVIA.questions - chosen.length, chosen.map((c) => c.id), false)));
  if (chosen.length < TRIVIA.minPracticeQuestions) throw new ServiceError(503, "TRIVIA_UNAVAILABLE", "Trivia isn't ready yet. Try again soon.");
  chosen = chosen.sort((a, b) => a.difficulty - b.difficulty);
  await db
    .insert(schema.triviaSet)
    .values({ id: newId(), mode: "DAILY", day, questionIds: chosen.map((c) => c.id) })
    .onConflictDoNothing();
  const [row] = await db.select().from(schema.triviaSet).where(and(eq(schema.triviaSet.mode, "DAILY"), eq(schema.triviaSet.day, day)));
  return row!;
}

async function buildPracticeSet(deps: BattleDeps, opts: TriviaOptions, category: TriviaCategory, genre: string | null): Promise<SetRow> {
  if (category === "GUESS_SONG" && !opts.audioPreviews) throw new ServiceError(409, "TRIVIA_UNAVAILABLE", "Guess the song isn't switched on yet.");
  await ensureTriviaBank(deps.db);
  const q = schema.triviaQuestion;
  const conds: SQL[] = [servable(opts), eq(q.category, category)];
  if (genre) conds.push(eq(q.genre, genre));
  const rows = await deps.db.select().from(q).where(and(...conds)).orderBy(sql`random()`).limit(TRIVIA.questions);
  if (rows.length < TRIVIA.minPracticeQuestions) throw new ServiceError(409, "TRIVIA_UNAVAILABLE", "Not enough questions here yet. Try another category.");
  const [set] = await deps.db
    .insert(schema.triviaSet)
    .values({ id: newId(), mode: "PRACTICE", category, genre, questionIds: rows.sort((a, b) => a.difficulty - b.difficulty).map((r) => r.id) })
    .returning();
  return set!;
}

async function userDay(db: Executor, user: UserRow, tz: unknown): Promise<string> {
  const zone = validTimeZone(tz) ?? (await db.select({ tz: schema.userProgress.timeZone }).from(schema.userProgress).where(eq(schema.userProgress.userId, user.id)))[0]?.tz ?? "UTC";
  return localDay(new Date(), zone);
}

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  return user;
}

// ── Playing ────────────────────────────────────────────────────────────────

export async function startTrivia(deps: BattleDeps, opts: TriviaOptions, viewer: UserRow | null, body: unknown): Promise<TriviaPlayView> {
  const user = requireUser(viewer);
  const b = (body ?? {}) as { mode?: unknown; category?: unknown; genre?: unknown; tz?: unknown };
  let set: SetRow;
  if (b.mode === "DAILY" || b.mode === undefined) {
    set = await buildDailySet(deps, opts, await userDay(deps.db, user, b.tz));
  } else if (b.mode === "PRACTICE") {
    if (!TRIVIA_CATEGORIES.includes(b.category as TriviaCategory)) throw new ServiceError(400, "INVALID_CATEGORY");
    const genre = typeof b.genre === "string" && b.genre ? b.genre : null;
    if (genre && !(GENRE_KEYS as string[]).includes(genre)) throw new ServiceError(400, "INVALID_GENRE");
    set = await buildPracticeSet(deps, opts, b.category as TriviaCategory, genre);
  } else {
    throw new ServiceError(400, "INVALID_MODE");
  }
  await deps.db
    .insert(schema.triviaPlay)
    .values({ id: newId(), setId: set.id, userId: user.id, total: set.questionIds.length })
    .onConflictDoNothing();
  const [play] = await deps.db.select().from(schema.triviaPlay).where(and(eq(schema.triviaPlay.setId, set.id), eq(schema.triviaPlay.userId, user.id)));
  return playView(deps, opts, user, play!.id);
}

async function loadPlay(db: Executor, user: UserRow, playId: string): Promise<{ play: PlayRow; set: SetRow }> {
  const [row] = await db
    .select({ play: schema.triviaPlay, set: schema.triviaSet })
    .from(schema.triviaPlay)
    .innerJoin(schema.triviaSet, eq(schema.triviaSet.id, schema.triviaPlay.setId))
    .where(eq(schema.triviaPlay.id, playId));
  if (!row || row.play.userId !== user.id) throw new ServiceError(404, "NOT_FOUND");
  return row;
}

async function audioUrlFor(db: Executor, trackId: string | null, opts: TriviaOptions): Promise<string | null> {
  if (!trackId || !opts.audioPreviews) return null;
  const refs = await db
    .select({ provider: schema.trackProviderRef.provider, url: schema.trackProviderRef.previewUrl })
    .from(schema.trackProviderRef)
    .where(and(eq(schema.trackProviderRef.trackId, trackId), isNotNull(schema.trackProviderRef.previewUrl)));
  return (refs.find((r) => r.provider === "APPLE_MUSIC") ?? refs.find((r) => r.provider === "VYBZ_DEMO"))?.url ?? null;
}

async function questionView(db: Executor, opts: TriviaOptions, q: QuestionRow, index: number, total: number, servedAt: Date): Promise<TriviaQuestionView> {
  let imageUrl: string | null = null;
  if (q.category === "ALBUM_ART" && q.trackId) {
    const [t] = await db.select({ art: schema.track.artworkUrl }).from(schema.track).where(eq(schema.track.id, q.trackId));
    imageUrl = t?.art ?? null;
  }
  return {
    id: q.id,
    index,
    total,
    category: q.category,
    genre: q.genre,
    prompt: q.prompt,
    choices: q.choices,
    imageUrl,
    audioUrl: q.category === "GUESS_SONG" ? await audioUrlFor(db, q.trackId, opts) : null,
    servedAt: servedAt.toISOString(),
    timeLimitMs: TRIVIA.answerMs,
  };
}

const expired = (servedAt: Date, now: Date) => now.getTime() - servedAt.getTime() > TRIVIA.answerMs + TRIVIA.graceMs;

/** Where the game stands. Shows (and starts the clock on) the next question; a question left past its limit counts as a miss. */
export async function playView(deps: BattleDeps, opts: TriviaOptions, viewer: UserRow | null, playId: string): Promise<TriviaPlayView> {
  const user = requireUser(viewer);
  const { play, set } = await loadPlay(deps.db, user, playId);
  if (play.finishedAt) return finishedView(deps, opts, user, play, set, []);
  const now = new Date();
  if (play.servedAt && expired(play.servedAt, now)) {
    const qid = set.questionIds[answersOf(play).length]!;
    const res = await recordAnswer(deps, opts, user, play.id, qid, null);
    if (res.finished) return playView(deps, opts, user, playId);
  }
  const fresh = await deps.db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.triviaPlay).where(eq(schema.triviaPlay.id, playId)).for("update");
    if (!p!.servedAt) {
      const [u] = await tx.update(schema.triviaPlay).set({ servedAt: now }).where(eq(schema.triviaPlay.id, playId)).returning();
      return u!;
    }
    return p!;
  });
  if (fresh.finishedAt) return finishedView(deps, opts, user, fresh, set, []);
  const index = answersOf(fresh).length;
  const [q] = await deps.db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.id, set.questionIds[index]!));
  return {
    id: fresh.id,
    mode: set.mode,
    status: "IN_PROGRESS",
    score: fresh.score,
    answered: index,
    total: fresh.total,
    question: await questionView(deps.db, opts, q!, index, fresh.total, fresh.servedAt!),
    result: null,
  };
}

async function finishedView(deps: BattleDeps, opts: TriviaOptions, user: UserRow, play: PlayRow, set: SetRow, badges: TriviaResult["badges"]): Promise<TriviaPlayView> {
  return {
    id: play.id,
    mode: set.mode,
    status: "FINISHED",
    score: play.score,
    answered: play.total,
    total: play.total,
    question: null,
    result: await resultFor(deps, opts, user, play, set, badges),
  };
}

export async function answerTrivia(deps: BattleDeps, opts: TriviaOptions, viewer: UserRow | null, playId: string, body: unknown): Promise<TriviaAnswerResult> {
  const user = requireUser(viewer);
  const b = (body ?? {}) as { questionId?: unknown; choice?: unknown };
  if (typeof b.questionId !== "string") throw new ServiceError(400, "INVALID_ANSWER");
  const choice = b.choice === null ? null : Number(b.choice);
  if (choice !== null && (!Number.isInteger(choice) || choice < 0 || choice > 5)) throw new ServiceError(400, "INVALID_ANSWER");
  return recordAnswer(deps, opts, user, playId, b.questionId, choice);
}

async function recordAnswer(deps: BattleDeps, opts: TriviaOptions, user: UserRow, playId: string, questionId: string, choice: number | null): Promise<TriviaAnswerResult> {
  const now = new Date();
  const out = await deps.db.transaction(async (tx) => {
    const [play] = await tx.select().from(schema.triviaPlay).where(eq(schema.triviaPlay.id, playId)).for("update");
    if (!play || play.userId !== user.id) throw new ServiceError(404, "NOT_FOUND");
    if (play.finishedAt) throw new ServiceError(409, "ALREADY_FINISHED");
    const [set] = await tx.select().from(schema.triviaSet).where(eq(schema.triviaSet.id, play.setId));
    const answers = answersOf(play);
    const index = answers.length;
    if (set!.questionIds[index] !== questionId) throw new ServiceError(409, "NOT_CURRENT_QUESTION", "That question has already been answered.");
    if (!play.servedAt) throw new ServiceError(409, "NOT_CURRENT_QUESTION");
    const [q] = await tx.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.id, questionId));
    const ms = now.getTime() - play.servedAt.getTime();
    const timedOut = expired(play.servedAt, now) || choice === null;
    const correct = !timedOut && choice === q!.answerIndex;
    const points = triviaPoints(correct, ms);
    const nextAnswers: StoredAnswer[] = [...answers, { questionId, choice: timedOut ? null : choice, correct, points, ms }];
    const finished = nextAnswers.length >= play.total;
    const [updated] = await tx
      .update(schema.triviaPlay)
      .set({
        answers: nextAnswers,
        score: play.score + points,
        correct: play.correct + (correct ? 1 : 0),
        servedAt: finished ? null : now,
        finishedAt: finished ? now : null,
      })
      .where(eq(schema.triviaPlay.id, playId))
      .returning();
    await tx
      .update(schema.triviaQuestion)
      .set({ timesAsked: sql`${schema.triviaQuestion.timesAsked} + 1`, timesCorrect: sql`${schema.triviaQuestion.timesCorrect} + ${correct ? 1 : 0}` })
      .where(eq(schema.triviaQuestion.id, questionId));
    return { play: updated!, set: set!, q: q!, correct, points, timedOut, finished };
  });
  let next: TriviaQuestionView | null = null;
  let badges: TriviaResult["badges"] = [];
  if (out.finished) {
    badges = await payOut(deps, user, out.play, out.set);
  } else {
    const index = answersOf(out.play).length;
    const [nq] = await deps.db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.id, out.set.questionIds[index]!));
    next = await questionView(deps.db, opts, nq!, index, out.play.total, out.play.servedAt!);
  }
  return {
    correct: out.correct,
    answerIndex: out.q.answerIndex,
    explanation: out.q.explanation,
    points: out.points,
    timedOut: out.timedOut,
    score: out.play.score,
    next,
    finished: out.finished,
  };
}

/** XP and coins for a finished game, then badge checks. Daily pays once per day; practice pays for a few games a day. */
async function payOut(deps: BattleDeps, user: UserRow, play: PlayRow, set: SetRow): Promise<TriviaResult["badges"]> {
  if ((await systemIds(deps.db, [user.id])).size) return [];
  await recordActivity(deps.db, user.id);
  try {
    if (set.mode === "DAILY") {
      await grant(deps.db, user.id, "TRIVIA", `daily:${set.day}`, triviaReward("DAILY", play.correct, play.total));
    } else if ((await practiceRewardsUsed(deps.db, user.id)) < TRIVIA.practiceRewardedPerDay) {
      const r = triviaReward("PRACTICE", play.correct, play.total);
      if (r.xp > 0) await grant(deps.db, user.id, "TRIVIA", `practice:${play.id}`, r);
    }
    const unlocked = await checkAchievements(deps.db, deps.push, [user.id]);
    return unlocked.map((d) => ({ code: d.code, title: d.title, icon: d.icon }));
  } catch (err) {
    console.error("trivia payout failed", err);
    return [];
  }
}

async function practiceRewardsUsed(db: Executor, userId: string): Promise<number> {
  const l = schema.ledgerEntry;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(l)
    .where(and(eq(l.userId, userId), eq(l.reason, "TRIVIA"), sql`${l.ref} like 'practice:%'`, gte(l.createdAt, new Date(Date.now() - 86_400_000))));
  return row?.n ?? 0;
}

async function resultFor(deps: BattleDeps, opts: TriviaOptions, user: UserRow, play: PlayRow, set: SetRow, badges: TriviaResult["badges"]): Promise<TriviaResult> {
  const db = deps.db;
  const questions = await db.select().from(schema.triviaQuestion).where(inArray(schema.triviaQuestion.id, set.questionIds));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answers = answersOf(play);
  const arts = await db
    .select({ id: schema.track.id, art: schema.track.artworkUrl })
    .from(schema.track)
    .where(inArray(schema.track.id, questions.flatMap((q) => (q.category === "ALBUM_ART" && q.trackId ? [q.trackId] : []))));
  const artOf = new Map(arts.map((a) => [a.id, a.art]));
  const review: TriviaReviewItem[] = set.questionIds.map((id, i) => {
    const q = byId.get(id)!;
    const a = answers[i];
    return {
      questionId: id,
      category: q.category,
      prompt: q.prompt,
      choices: q.choices,
      imageUrl: q.trackId ? (artOf.get(q.trackId) ?? null) : null,
      answerIndex: q.answerIndex,
      yourChoice: a?.choice ?? null,
      correct: a?.correct ?? false,
      points: a?.points ?? 0,
      explanation: q.explanation,
      communityCorrectPct: q.timesAsked > 1 ? Math.round((100 * q.timesCorrect) / q.timesAsked) : null,
    };
  });

  let community: TriviaResult["community"] = null;
  if (set.mode === "DAILY") {
    const p = schema.triviaPlay;
    const [c] = await db
      .select({
        players: sql<number>`count(*)::int`,
        avg: sql<number>`coalesce(avg(${p.score}), 0)::float`,
        below: sql<number>`count(*) filter (where ${p.score} < ${play.score})::int`,
        above: sql<number>`count(*) filter (where ${p.score} > ${play.score} or (${p.score} = ${play.score} and ${p.finishedAt} < ${play.finishedAt!}))::int`,
      })
      .from(p)
      .innerJoin(schema.user, eq(schema.user.id, p.userId))
      .where(and(eq(p.setId, set.id), isNotNull(p.finishedAt), eq(schema.user.isSystem, false)));
    const players = c?.players ?? 1;
    community = {
      players,
      averageScore: Math.round(c?.avg ?? play.score),
      percentile: players > 1 ? Math.round((100 * (c?.below ?? 0)) / (players - 1)) : 100,
      rank: (c?.above ?? 0) + 1,
    };
  }

  // Badges this game unlocked, also when the result is looked at again later.
  if (!badges.length && play.finishedAt) {
    const got = await db
      .select({ code: schema.userAchievement.code })
      .from(schema.userAchievement)
      .where(
        and(
          eq(schema.userAchievement.userId, user.id),
          gte(schema.userAchievement.unlockedAt, play.finishedAt),
          lte(schema.userAchievement.unlockedAt, new Date(play.finishedAt.getTime() + 30_000)),
        ),
      );
    badges = got.flatMap((r) => {
      const d = achievementDef(r.code);
      return d && d.code.startsWith("trivia_") ? [{ code: d.code, title: d.title, icon: d.icon }] : [];
    });
  }

  // Point the "win a battle" button at the genre they did best in.
  const tally = new Map<string, number>();
  review.forEach((r) => {
    const gk = byId.get(r.questionId)!.genre;
    if (gk) tally.set(gk, (tally.get(gk) ?? 0) + (r.correct ? 2 : 1));
  });
  const battleGenre = set.genre ?? [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const ledger = await db
    .select({ xp: schema.ledgerEntry.xp, coins: schema.ledgerEntry.coins })
    .from(schema.ledgerEntry)
    .where(and(eq(schema.ledgerEntry.userId, user.id), eq(schema.ledgerEntry.reason, "TRIVIA"), eq(schema.ledgerEntry.ref, set.mode === "DAILY" ? `daily:${set.day}` : `practice:${play.id}`)));
  const streak = await triviaStreak(db, user.id);
  void opts;
  return {
    playId: play.id,
    mode: set.mode as TriviaMode,
    day: set.day,
    category: (set.category as TriviaCategory | null) ?? null,
    genre: set.genre,
    score: play.score,
    maxScore: triviaMaxScore(play.total),
    correct: play.correct,
    total: play.total,
    reward: { xp: ledger[0]?.xp ?? 0, coins: ledger[0]?.coins ?? 0 },
    community,
    streak,
    review,
    badges,
    battleGenre,
  };
}

async function triviaStreak(db: Executor, userId: string): Promise<{ current: number; best: number }> {
  const { streaksFor } = await import("./streaks");
  return (await streaksFor(db, userId)).trivia;
}

// ── Hub and leaderboards ───────────────────────────────────────────────────

export async function triviaHub(deps: BattleDeps, opts: TriviaOptions, viewer: UserRow | null, tz: unknown): Promise<TriviaHubResponse> {
  const user = requireUser(viewer);
  await ensureTriviaBank(deps.db);
  const day = await userDay(deps.db, user, tz);
  const q = schema.triviaQuestion;
  const [setRow] = await deps.db.select().from(schema.triviaSet).where(and(eq(schema.triviaSet.mode, "DAILY"), eq(schema.triviaSet.day, day)));
  const [mine] = setRow ? await deps.db.select().from(schema.triviaPlay).where(and(eq(schema.triviaPlay.setId, setRow.id), eq(schema.triviaPlay.userId, user.id))) : [];
  const [counts, players, used, streak, board] = await Promise.all([
    deps.db.select({ category: q.category, n: sql<number>`count(*)::int` }).from(q).where(servable(opts)).groupBy(q.category),
    setRow
      ? deps.db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.triviaPlay)
          .where(and(eq(schema.triviaPlay.setId, setRow.id), isNotNull(schema.triviaPlay.finishedAt)))
      : Promise.resolve([{ n: 0 }]),
    practiceRewardsUsed(deps.db, user.id),
    triviaStreak(deps.db, user.id),
    triviaLeaderboard(deps, viewer, { period: "today", scope: "global", tz }),
  ]);
  const n = new Map(counts.map((c) => [c.category, c.n]));
  return {
    day,
    daily: {
      status: mine?.finishedAt ? "FINISHED" : mine ? "IN_PROGRESS" : "NOT_STARTED",
      playId: mine?.id ?? null,
      score: mine?.finishedAt ? mine.score : null,
      players: players[0]?.n ?? 0,
    },
    streak,
    categories: TRIVIA_CATEGORIES.map((c) => ({
      category: c,
      ...TRIVIA_CATEGORY_INFO[c],
      questions: n.get(c) ?? 0,
      available: (n.get(c) ?? 0) >= TRIVIA.minPracticeQuestions && (c !== "GUESS_SONG" || opts.audioPreviews),
    })),
    practiceRewardsLeft: Math.max(0, TRIVIA.practiceRewardedPerDay - used),
    top: board.rows.slice(0, 5),
  };
}

export async function triviaLeaderboard(
  deps: BattleDeps,
  viewer: UserRow | null,
  query: { period?: unknown; scope?: unknown; tz?: unknown },
): Promise<TriviaLeaderboardResponse> {
  const period = (query.period ?? "today") as TriviaLeaderboardPeriod;
  const scope = (query.scope ?? "global") as "global" | "following";
  if (!["today", "week", "all"].includes(period) || !["global", "following"].includes(scope)) throw new ServiceError(400, "INVALID_QUERY");
  if (scope === "following" && !viewer) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  const day = viewer ? await userDay(deps.db, viewer, query.tz) : localDay(new Date(), validTimeZone(query.tz) ?? "UTC");
  const p = schema.triviaPlay;
  const s = schema.triviaSet;
  const conds: SQL[] = [eq(s.mode, "DAILY"), isNotNull(p.finishedAt), eq(schema.user.status, "ACTIVE"), eq(schema.user.isSystem, false)];
  if (period === "today") conds.push(eq(s.day, day));
  if (period === "week") conds.push(gte(s.day, shiftDay(day, -6)), lte(s.day, day));
  if (scope === "following") {
    const followed = deps.db.select({ id: schema.follow.followeeId }).from(schema.follow).where(eq(schema.follow.followerId, viewer!.id));
    conds.push(or(eq(p.userId, viewer!.id), inArray(p.userId, followed))!);
  }
  const rows = await deps.db
    .select({ userId: p.userId, score: sql<number>`sum(${p.score})::int`, games: sql<number>`count(*)::int`, first: sql<Date>`min(${p.finishedAt})` })
    .from(p)
    .innerJoin(s, eq(s.id, p.setId))
    .innerJoin(schema.user, eq(schema.user.id, p.userId))
    .where(and(...conds))
    .groupBy(p.userId)
    .orderBy(desc(sql`sum(${p.score})`), sql`min(${p.finishedAt})`)
    .limit(500);
  const ranks: number[] = [];
  rows.forEach((r, i) => (ranks[i] = i > 0 && r.score === rows[i - 1]!.score ? ranks[i - 1]! : i + 1));
  const shown = rows.slice(0, 50);
  const myIndex = viewer ? rows.findIndex((r) => r.userId === viewer.id) : -1;
  const users = await usersById(deps.db, [...new Set([...shown.map((r) => r.userId), ...(myIndex >= 0 ? [viewer!.id] : [])])]);
  const row = (r: (typeof rows)[number], i: number): TriviaLeaderRow => ({
    rank: ranks[i]!,
    user: users.get(r.userId) ?? { id: r.userId, handle: "unknown", displayName: "Unknown", image: null },
    score: r.score,
    games: r.games,
    isYou: r.userId === viewer?.id,
  });
  return { period, scope, day, rows: shown.map(row), you: myIndex >= 0 ? row(rows[myIndex]!, myIndex) : null };
}

/** "Something's wrong with this question." Only people who were asked it can flag it. */
export async function flagTriviaQuestion(deps: BattleDeps, viewer: UserRow | null, questionId: string, body: unknown): Promise<{ ok: true }> {
  const user = requireUser(viewer);
  const reason = String((body as { reason?: unknown } | null)?.reason ?? "").trim().slice(0, 280);
  if (!reason) throw new ServiceError(400, "REASON_REQUIRED", "Say what's wrong with it.");
  const [seen] = await deps.db
    .select({ id: schema.triviaPlay.id })
    .from(schema.triviaPlay)
    .innerJoin(schema.triviaSet, eq(schema.triviaSet.id, schema.triviaPlay.setId))
    .where(and(eq(schema.triviaPlay.userId, user.id), sql`${questionId} = any(${schema.triviaSet.questionIds})`))
    .limit(1);
  if (!seen) throw new ServiceError(404, "NOT_FOUND");
  await deps.db
    .insert(schema.triviaFlag)
    .values({ questionId, userId: user.id, reason })
    .onConflictDoUpdate({ target: [schema.triviaFlag.questionId, schema.triviaFlag.userId], set: { reason, resolvedAt: null } });
  return { ok: true };
}

// ── Staff: review and manage questions ─────────────────────────────────────

function requireStaff(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!isStaff(user)) throw new ServiceError(403, "FORBIDDEN");
  return user;
}

const STATUSES: (TriviaQuestionStatus | "FLAGGED")[] = ["DRAFT", "APPROVED", "REJECTED", "RETIRED", "FLAGGED"];

export async function adminTriviaList(deps: BattleDeps, viewer: UserRow | null, sp: URLSearchParams): Promise<TriviaAdminList> {
  requireStaff(viewer);
  await ensureTriviaBank(deps.db);
  const status = (sp.get("status") ?? "DRAFT") as TriviaQuestionStatus | "FLAGGED";
  const category = sp.get("category");
  const search = sp.get("q")?.trim();
  if (!STATUSES.includes(status)) throw new ServiceError(400, "INVALID_QUERY");
  if (category && !TRIVIA_CATEGORIES.includes(category as TriviaCategory)) throw new ServiceError(400, "INVALID_QUERY");
  const q = schema.triviaQuestion;
  const f = schema.triviaFlag;
  const openFlags = deps.db.select({ id: f.questionId }).from(f).where(isNull(f.resolvedAt));
  const conds: SQL[] = [status === "FLAGGED" ? inArray(q.id, openFlags) : eq(q.status, status)];
  if (category) conds.push(eq(q.category, category as TriviaCategory));
  if (search) conds.push(sql`${q.prompt} ilike ${`%${search.replace(/[%_]/g, "")}%`}`);
  const [rows, counts, flagCount] = await Promise.all([
    deps.db.select().from(q).where(and(...conds)).orderBy(desc(q.createdAt)).limit(100),
    deps.db.select({ status: q.status, n: sql<number>`count(*)::int` }).from(q).groupBy(q.status),
    deps.db.select({ n: sql<number>`count(distinct ${f.questionId})::int` }).from(f).where(isNull(f.resolvedAt)),
  ]);
  return {
    items: await adminViews(deps.db, rows),
    counts: {
      DRAFT: 0,
      APPROVED: 0,
      REJECTED: 0,
      RETIRED: 0,
      ...Object.fromEntries(counts.map((c) => [c.status, c.n])),
      FLAGGED: flagCount[0]?.n ?? 0,
    } as TriviaAdminList["counts"],
  };
}

async function adminViews(db: Executor, rows: QuestionRow[]): Promise<TriviaAdminQuestion[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [flags, arts, previews, reviewers] = await Promise.all([
    db.select().from(schema.triviaFlag).where(and(inArray(schema.triviaFlag.questionId, ids), isNull(schema.triviaFlag.resolvedAt))),
    db.select({ id: schema.track.id, art: schema.track.artworkUrl }).from(schema.track).where(inArray(schema.track.id, rows.flatMap((r) => (r.trackId ? [r.trackId] : [])))),
    db
      .select({ id: schema.trackProviderRef.trackId })
      .from(schema.trackProviderRef)
      .where(and(inArray(schema.trackProviderRef.trackId, rows.flatMap((r) => (r.trackId ? [r.trackId] : []))), isNotNull(schema.trackProviderRef.previewUrl))),
    usersById(db, [...new Set(rows.flatMap((r) => (r.reviewedById ? [r.reviewedById] : [])))]),
  ]);
  const art = new Map(arts.map((a) => [a.id, a.art]));
  const audio = new Set(previews.map((p) => p.id));
  return rows.map((r) => {
    const fl = flags.filter((x) => x.questionId === r.id);
    return {
      id: r.id,
      category: r.category,
      genre: r.genre,
      difficulty: r.difficulty,
      prompt: r.prompt,
      choices: r.choices,
      answerIndex: r.answerIndex,
      explanation: r.explanation,
      imageUrl: r.category === "ALBUM_ART" && r.trackId ? (art.get(r.trackId) ?? null) : null,
      hasAudio: r.category === "GUESS_SONG" && !!r.trackId && audio.has(r.trackId),
      source: r.source,
      status: r.status,
      timesAsked: r.timesAsked,
      correctPct: r.timesAsked ? Math.round((100 * r.timesCorrect) / r.timesAsked) : null,
      flags: fl.length,
      flagReasons: fl.map((x) => x.reason).slice(0, 5),
      createdAt: r.createdAt.toISOString(),
      reviewedBy: r.reviewedById ? (reviewers.get(r.reviewedById)?.handle ?? null) : null,
    };
  });
}

function parseInput(body: unknown, partial: boolean): Partial<TriviaQuestionInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Partial<TriviaQuestionInput> = {};
  if (b.category !== undefined || !partial) {
    if (!TRIVIA_CATEGORIES.includes(b.category as TriviaCategory)) throw new ServiceError(400, "INVALID_CATEGORY");
    out.category = b.category as TriviaCategory;
  }
  if (b.genre !== undefined) {
    if (b.genre !== null && b.genre !== "" && !(GENRE_KEYS as string[]).includes(String(b.genre))) throw new ServiceError(400, "INVALID_GENRE");
    out.genre = b.genre ? String(b.genre) : null;
  }
  if (b.difficulty !== undefined) {
    const d = Number(b.difficulty);
    if (![1, 2, 3].includes(d)) throw new ServiceError(400, "INVALID_DIFFICULTY");
    out.difficulty = d;
  }
  if (b.prompt !== undefined || !partial) {
    const p = String(b.prompt ?? "").trim();
    if (p.length < 8 || p.length > 300) throw new ServiceError(400, "INVALID_PROMPT", "Questions need 8–300 characters.");
    out.prompt = p;
  }
  if (b.choices !== undefined || !partial) {
    const c = Array.isArray(b.choices) ? b.choices.map((x) => String(x).trim()).filter(Boolean) : [];
    if (c.length < 2 || c.length > 6 || c.some((x) => x.length > 120) || new Set(c.map((x) => x.toLowerCase())).size !== c.length) {
      throw new ServiceError(400, "INVALID_CHOICES", "Give 2–6 different answers, each up to 120 characters.");
    }
    out.choices = c;
  }
  if (b.answerIndex !== undefined || !partial) {
    const i = Number(b.answerIndex);
    if (!Number.isInteger(i) || i < 0) throw new ServiceError(400, "INVALID_ANSWER");
    out.answerIndex = i;
  }
  if (b.explanation !== undefined) out.explanation = b.explanation ? String(b.explanation).trim().slice(0, 400) : null;
  const lyrics = lyricsProblem(out.prompt, out.explanation, ...(out.choices ?? []));
  if (lyrics) throw new ServiceError(400, "LYRICS_NOT_ALLOWED", lyrics);
  return out;
}

export async function adminCreateQuestion(deps: BattleDeps, viewer: UserRow | null, body: unknown): Promise<TriviaAdminQuestion> {
  const staff = requireStaff(viewer);
  const input = parseInput(body, false) as TriviaQuestionInput;
  if (input.answerIndex >= input.choices.length) throw new ServiceError(400, "INVALID_ANSWER");
  if (input.category === "ALBUM_ART" || input.category === "GUESS_SONG") {
    throw new ServiceError(400, "INVALID_CATEGORY", "Album art and Guess the song questions are made from the catalog.");
  }
  const approve = (body as { approve?: unknown } | null)?.approve === true;
  const [row] = await deps.db
    .insert(schema.triviaQuestion)
    .values({
      id: newId(),
      category: input.category,
      genre: input.genre ?? null,
      difficulty: input.difficulty ?? 2,
      prompt: input.prompt,
      choices: input.choices,
      answerIndex: input.answerIndex,
      explanation: input.explanation ?? null,
      source: "ADMIN",
      status: approve ? "APPROVED" : "DRAFT",
      createdById: staff.id,
      ...(approve ? { reviewedById: staff.id, reviewedAt: new Date() } : {}),
    })
    .returning();
  return (await adminViews(deps.db, [row!]))[0]!;
}

export async function adminUpdateQuestion(deps: BattleDeps, viewer: UserRow | null, id: string, body: unknown): Promise<TriviaAdminQuestion> {
  const staff = requireStaff(viewer);
  const [current] = await deps.db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.id, id));
  if (!current) throw new ServiceError(404, "NOT_FOUND");
  const input = parseInput(body, true);
  const choices = input.choices ?? current.choices;
  const answerIndex = input.answerIndex ?? (input.choices ? -1 : current.answerIndex);
  if (answerIndex < 0 || answerIndex >= choices.length) throw new ServiceError(400, "INVALID_ANSWER", "Pick which answer is right.");
  if (input.category && input.category !== current.category && (input.category === "ALBUM_ART" || input.category === "GUESS_SONG" || current.trackId)) {
    throw new ServiceError(400, "INVALID_CATEGORY");
  }
  const status = (body as { status?: unknown } | null)?.status;
  if (status !== undefined && !["DRAFT", "APPROVED", "REJECTED", "RETIRED"].includes(String(status))) throw new ServiceError(400, "INVALID_STATUS");
  const [row] = await deps.db
    .update(schema.triviaQuestion)
    .set({
      ...input,
      choices,
      answerIndex,
      ...(status ? { status: status as TriviaQuestionStatus, reviewedById: staff.id, reviewedAt: new Date() } : {}),
    })
    .where(eq(schema.triviaQuestion.id, id))
    .returning();
  // Editing or deciding on a question settles its open flags.
  await deps.db.update(schema.triviaFlag).set({ resolvedAt: new Date() }).where(and(eq(schema.triviaFlag.questionId, id), isNull(schema.triviaFlag.resolvedAt)));
  return (await adminViews(deps.db, [row!]))[0]!;
}

/** Approve or reject many drafts at once. */
export async function adminBulkStatus(deps: BattleDeps, viewer: UserRow | null, body: unknown): Promise<{ updated: number }> {
  const staff = requireStaff(viewer);
  const b = (body ?? {}) as { ids?: unknown; status?: unknown };
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  if (!ids.length || !["APPROVED", "REJECTED", "RETIRED"].includes(String(b.status))) throw new ServiceError(400, "INVALID_REQUEST");
  const rows = await deps.db
    .update(schema.triviaQuestion)
    .set({ status: b.status as TriviaQuestionStatus, reviewedById: staff.id, reviewedAt: new Date() })
    .where(inArray(schema.triviaQuestion.id, ids))
    .returning({ id: schema.triviaQuestion.id });
  await deps.db.update(schema.triviaFlag).set({ resolvedAt: new Date() }).where(and(inArray(schema.triviaFlag.questionId, ids), isNull(schema.triviaFlag.resolvedAt)));
  return { updated: rows.length };
}

export async function adminGenerateFromCatalog(deps: BattleDeps, viewer: UserRow | null): Promise<{ added: number }> {
  requireStaff(viewer);
  return { added: await generateCatalogQuestions(deps.db, 60) };
}

/** Writes draft questions; staff approve them before anyone sees them. */
export interface TriviaDrafter {
  draft(input: { category: TriviaCategory; genre: string | null; count: number; avoid: string[] }): Promise<TriviaQuestionInput[]>;
}

export async function adminDraftWithAi(deps: BattleDeps, drafter: TriviaDrafter | null, viewer: UserRow | null, body: unknown): Promise<{ added: number; skipped: number }> {
  const staff = requireStaff(viewer);
  if (!drafter) throw new ServiceError(409, "AI_UNAVAILABLE", "Set ANTHROPIC_API_KEY to draft questions with AI.");
  const b = (body ?? {}) as { category?: unknown; genre?: unknown; count?: unknown };
  const category = b.category as TriviaCategory;
  if (!["GENRE", "ARTIST", "HISTORY"].includes(category)) throw new ServiceError(400, "INVALID_CATEGORY", "AI can draft genre, artist and history questions.");
  const genre = typeof b.genre === "string" && b.genre ? b.genre : null;
  if (genre && !(GENRE_KEYS as string[]).includes(genre)) throw new ServiceError(400, "INVALID_GENRE");
  const count = Math.min(10, Math.max(1, Number(b.count) || 5));
  const q = schema.triviaQuestion;
  const existing = await deps.db
    .select({ prompt: q.prompt })
    .from(q)
    .where(and(eq(q.category, category), genre ? eq(q.genre, genre) : sql`true`))
    .orderBy(desc(q.createdAt))
    .limit(80);
  let drafts: TriviaQuestionInput[];
  try {
    drafts = await drafter.draft({ category, genre, count, avoid: existing.map((e) => e.prompt) });
  } catch (err) {
    console.error("trivia drafting failed", err);
    throw new ServiceError(502, "AI_FAILED", "The AI couldn't draft questions just now. Try again.");
  }
  const seen = new Set(existing.map((e) => e.prompt.toLowerCase()));
  let skipped = 0;
  const rows: (typeof q.$inferInsert)[] = [];
  for (const d of drafts) {
    try {
      const input = parseInput({ ...d, category, genre }, false) as TriviaQuestionInput;
      if (input.answerIndex >= input.choices.length || seen.has(input.prompt.toLowerCase())) throw new Error("bad");
      seen.add(input.prompt.toLowerCase());
      rows.push({
        id: newId(),
        category,
        genre,
        difficulty: input.difficulty ?? 2,
        prompt: input.prompt,
        choices: input.choices,
        answerIndex: input.answerIndex,
        explanation: input.explanation ?? null,
        source: "AI",
        status: "DRAFT",
        createdById: staff.id,
      });
    } catch {
      skipped++;
    }
  }
  if (rows.length) await deps.db.insert(q).values(rows);
  return { added: rows.length, skipped };
}
