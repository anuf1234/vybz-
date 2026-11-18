import { TRIVIA, lyricsProblem, triviaPoints } from "@vybz/core";
import { type DbHandle, eq, newId, schema, sql } from "@vybz/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { achievementsFor } from "../src/server/achievements";
import {
  adminBulkStatus,
  adminCreateQuestion,
  adminDraftWithAi,
  adminGenerateFromCatalog,
  adminTriviaList,
  adminUpdateQuestion,
  answerTrivia,
  flagTriviaQuestion,
  playView,
  startTrivia,
  triviaHub,
  triviaLeaderboard,
} from "../src/server/trivia";
import { TEST_DB_URL, freshDb } from "./helpers";

const OFF = { audioPreviews: false };
const ON = { audioPreviews: true };

describe("trivia rules", () => {
  it("scores correct answers with a speed bonus", () => {
    expect(triviaPoints(false, 100)).toBe(0);
    expect(triviaPoints(true, 0)).toBe(150);
    expect(triviaPoints(true, TRIVIA.answerMs / 2)).toBe(125);
    expect(triviaPoints(true, TRIVIA.answerMs * 2)).toBe(100);
  });

  it("keeps lyrics out", () => {
    expect(lyricsProblem('Who sang "Purple Rain"?')).toBeNull();
    expect(lyricsProblem("Finish the line: ...")).not.toBeNull();
    expect(lyricsProblem("Which song has these lyrics?")).not.toBeNull();
    expect(lyricsProblem('Which song opens with "one two three four five six seven eight nine ten"?')).not.toBeNull();
  });
});

describe.skipIf(!TEST_DB_URL)("step 7: trivia", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let ava: UserRow;
  let ben: UserRow;
  let mod: UserRow;

  const answerOf = async (questionId: string) => (await h.db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.id, questionId)))[0]!.answerIndex;

  /** Plays a whole game, getting the first `right` answers correct. */
  const play = async (user: UserRow, body: unknown, right: number, opts = OFF) => {
    let view = await startTrivia(deps, opts, user, body);
    let last;
    for (let i = 0; view.question; i++) {
      const q = view.question;
      const a = await answerOf(q.id);
      last = await answerTrivia(deps, opts, user, view.id, { questionId: q.id, choice: i < right ? a : (a + 1) % q.choices.length });
      view = last.next ? { ...view, question: last.next } : { ...view, question: null };
    }
    return { last: last!, result: (await playView(deps, opts, user, view.id)).result! };
  };

  beforeAll(async () => {
    h = await freshDb();
    deps = { db: h.db, catalog: { metadata: [], playback: {}, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    [ava, ben, mod] = (await h.db
      .insert(schema.user)
      .values([
        { id: "u_ava", name: "Ava", email: "ava@x.com", handle: "ava" },
        { id: "u_ben", name: "Ben", email: "ben@x.com", handle: "ben" },
        { id: "u_mod", name: "Mod", email: "mod@x.com", handle: "mod", role: "MODERATOR" },
      ])
      .returning()) as [UserRow, UserRow, UserRow];
    // A small catalog for album art, artist and Guess the song questions.
    const tracks = [
      ["Velvet Circuit", "Kaia Stone", "Night Drive", 2001],
      ["Brass Hearts", "Juno Reyes", "Sunday Service", 1998],
      ["Low Tide", "The Marlowes", "Harbor Lights - Single", 2015],
      ["Paper Planes", "Odessa Gray", "Cloud Atlas", 2010],
      ["Gold Rush", "Lenny Ford", "Prospector", 1977],
    ] as const;
    for (const [title, artist, album, year] of tracks) {
      const id = newId();
      await h.db.insert(schema.track).values({ id, title, artistName: artist, albumName: album, releaseYear: year, artworkUrl: `https://is1-ssl.mzstatic.com/${id}.jpg`, genres: ["R&B/Soul"] });
      await h.db.insert(schema.trackProviderRef).values({ id: newId(), trackId: id, provider: "APPLE_MUSIC", externalId: id, previewUrl: `https://audio-ssl.itunes.apple.com/${id}.m4a` });
    }
  });
  afterAll(() => h?.close());

  it("loads the starter bank and gives everyone the same daily 10", async () => {
    const a = await startTrivia(deps, OFF, ava, { mode: "DAILY", tz: "America/New_York" });
    const b = await startTrivia(deps, OFF, ben, { mode: "DAILY", tz: "America/New_York" });
    expect(a.total).toBe(10);
    expect(a.question!.choices.length).toBe(4);
    expect(a.question).not.toHaveProperty("answerIndex");
    const sets = await h.db.select().from(schema.triviaSet);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.questionIds).toHaveLength(10);
    expect(b.question!.id).toBe(a.question!.id);
    // Starting again resumes the same game rather than giving a second try.
    const again = await startTrivia(deps, OFF, ava, { mode: "DAILY", tz: "America/New_York" });
    expect(again.id).toBe(a.id);
  });

  it("checks answers one at a time, in order, against the clock", async () => {
    const v = await playView(deps, OFF, ava, (await startTrivia(deps, OFF, ava, { mode: "DAILY" })).id);
    const q = v.question!;
    const right = await answerOf(q.id);
    const r = await answerTrivia(deps, OFF, ava, v.id, { questionId: q.id, choice: right });
    expect(r).toMatchObject({ correct: true, answerIndex: right, timedOut: false, finished: false });
    expect(r.points).toBeGreaterThan(100);
    await expect(answerTrivia(deps, OFF, ava, v.id, { questionId: q.id, choice: right })).rejects.toMatchObject({ code: "NOT_CURRENT_QUESTION" });
    await expect(answerTrivia(deps, OFF, ben, v.id, { questionId: r.next!.id, choice: 0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Too slow: the right answer earns nothing.
    await h.db.update(schema.triviaPlay).set({ servedAt: new Date(Date.now() - 60_000) }).where(eq(schema.triviaPlay.id, v.id));
    const slow = await answerTrivia(deps, OFF, ava, v.id, { questionId: r.next!.id, choice: await answerOf(r.next!.id) });
    expect(slow).toMatchObject({ correct: false, timedOut: true, points: 0 });
  });

  it("counts a question left open past its limit as a miss", async () => {
    const id = (await startTrivia(deps, OFF, ava, { mode: "DAILY" })).id;
    await h.db.update(schema.triviaPlay).set({ servedAt: new Date(Date.now() - 60_000) }).where(eq(schema.triviaPlay.id, id));
    const v = await playView(deps, OFF, ava, id);
    expect(v.answered).toBe(3);
  });

  it("finishes with XP, community comparison, streak and a badge", async () => {
    // Ava finishes the game she started; Ben plays a perfect one.
    const id = (await startTrivia(deps, OFF, ava, { mode: "DAILY" })).id;
    let v = await playView(deps, OFF, ava, id);
    while (v.question) {
      const r = await answerTrivia(deps, OFF, ava, id, { questionId: v.question.id, choice: (await answerOf(v.question.id)) });
      v = r.next ? { ...v, question: r.next } : { ...v, question: null };
    }
    const avaResult = (await playView(deps, OFF, ava, id)).result!;
    expect(avaResult.correct).toBe(8);
    expect(avaResult.reward).toEqual({ xp: TRIVIA.dailyXp + 8 * TRIVIA.dailyXpPerCorrect, coins: 0 });
    expect(avaResult.streak.current).toBe(1);
    expect(avaResult.badges.map((b) => b.code)).toContain("trivia_first");

    const { result } = await play(ben, { mode: "DAILY" }, 10);
    expect(result.correct).toBe(10);
    expect(result.reward.coins).toBe(TRIVIA.perfectCoins);
    expect(result.community).toMatchObject({ players: 2, rank: 1, percentile: 100 });
    expect(result.badges.map((b) => b.code)).toEqual(expect.arrayContaining(["trivia_first", "trivia_perfect"]));
    expect(result.review).toHaveLength(10);
    expect(result.review.every((r) => r.correct)).toBe(true);
    expect(result.review[0]!.communityCorrectPct).not.toBeNull();

    const again = (await playView(deps, OFF, ava, id)).result!;
    expect(again.community).toMatchObject({ players: 2, rank: 2, percentile: 0 });
    // Paid once only.
    const ledger = await h.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.reason, "TRIVIA"));
    expect(ledger).toHaveLength(2);
    const ach = await achievementsFor(h.db, ben.id);
    expect(ach.items.find((x) => x.code === "trivia_perfect")!.unlockedAt).not.toBeNull();
  });

  it("ranks today's players and shows the hub", async () => {
    const board = await triviaLeaderboard(deps, ava, { period: "today" });
    expect(board.rows.map((r) => r.user.handle)).toEqual(["ben", "ava"]);
    expect(board.you).toMatchObject({ rank: 2, isYou: true });
    const week = await triviaLeaderboard(deps, ava, { period: "week", scope: "following" });
    expect(week.rows.map((r) => r.user.handle)).toEqual(["ava"]);
    const hub = await triviaHub(deps, OFF, ava, null);
    expect(hub.daily).toMatchObject({ status: "FINISHED", players: 2 });
    expect(hub.top[0]!.user.handle).toBe("ben");
    expect(hub.categories.find((c) => c.category === "GUESS_SONG")!.available).toBe(false);
    expect(hub.categories.find((c) => c.category === "ARTIST")!.available).toBe(true);
  });

  it("practice games by category pay a few times a day", async () => {
    const r1 = await play(ava, { mode: "PRACTICE", category: "ARTIST", genre: "hiphop" }, 5);
    expect(r1.result.mode).toBe("PRACTICE");
    expect(r1.result.battleGenre).toBe("hiphop");
    expect(r1.result.reward.xp).toBe(5 * TRIVIA.practiceXpPerCorrect);
    await play(ava, { mode: "PRACTICE", category: "HISTORY" }, 1);
    await play(ava, { mode: "PRACTICE", category: "GENRE" }, 1);
    const r4 = await play(ava, { mode: "PRACTICE", category: "HISTORY" }, 3);
    expect(r4.result.reward.xp).toBe(0);
    await expect(startTrivia(deps, OFF, ava, { mode: "PRACTICE", category: "GUESS_SONG" })).rejects.toMatchObject({ code: "TRIVIA_UNAVAILABLE" });
    await expect(startTrivia(deps, OFF, ava, { mode: "PRACTICE", category: "NOPE" })).rejects.toMatchObject({ code: "INVALID_CATEGORY" });
  });

  it("builds album art, artist and Guess the song questions from the catalog", async () => {
    await expect(adminGenerateFromCatalog(deps, ava)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { added } = await adminGenerateFromCatalog(deps, mod);
    expect(added).toBeGreaterThan(10);
    const rows = await h.db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.source, "CATALOG"));
    const art = rows.find((r) => r.category === "ALBUM_ART")!;
    expect(art.status).toBe("APPROVED");
    expect(art.choices).not.toContain("Harbor Lights - Single");
    expect(rows.filter((r) => r.category === "HISTORY").every((r) => r.status === "DRAFT")).toBe(true);
    const r = await play(ben, { mode: "PRACTICE", category: "GUESS_SONG" }, 5, ON);
    expect(r.result.total).toBe(5);
    const v = await startTrivia(deps, ON, ava, { mode: "PRACTICE", category: "ALBUM_ART" });
    expect(v.question!.imageUrl).toMatch(/^https:\/\/is1-ssl\.mzstatic\.com\//);
    const song = await startTrivia(deps, ON, ava, { mode: "PRACTICE", category: "GUESS_SONG" });
    expect(song.question!.audioUrl).toMatch(/^https:\/\/audio-ssl\.itunes\.apple\.com\//);
  });

  it("lets staff write, review, edit and retire questions", async () => {
    await expect(adminTriviaList(deps, ava, new URLSearchParams())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      adminCreateQuestion(deps, mod, { category: "HISTORY", prompt: "Which song has these lyrics in its chorus?", choices: ["A", "B", "C", "D"], answerIndex: 0 }),
    ).rejects.toMatchObject({ code: "LYRICS_NOT_ALLOWED" });
    const q = await adminCreateQuestion(deps, mod, { category: "HISTORY", genre: "jazz", prompt: "Which label released Kind of Blue?", choices: ["Columbia", "Blue Note", "Verve", "Impulse!"], answerIndex: 0 });
    expect(q).toMatchObject({ status: "DRAFT", source: "ADMIN" });
    const drafts = await adminTriviaList(deps, mod, new URLSearchParams({ status: "DRAFT", q: "kind of blue" }));
    expect(drafts.items.map((i) => i.id)).toEqual([q.id]);
    const edited = await adminUpdateQuestion(deps, mod, q.id, { explanation: "Columbia released it in 1959.", status: "APPROVED" });
    expect(edited).toMatchObject({ status: "APPROVED", reviewedBy: "mod", explanation: "Columbia released it in 1959." });
    await expect(adminUpdateQuestion(deps, mod, q.id, { choices: ["A", "B"] })).rejects.toMatchObject({ code: "INVALID_ANSWER" });
    const bulk = await adminBulkStatus(deps, mod, { ids: [q.id], status: "RETIRED" });
    expect(bulk.updated).toBe(1);
  });

  it("puts flagged questions in front of staff", async () => {
    const [set] = await h.db.select().from(schema.triviaSet).where(eq(schema.triviaSet.mode, "DAILY"));
    const qid = set!.questionIds[0]!;
    await expect(flagTriviaQuestion(deps, mod, qid, { reason: "wrong" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await flagTriviaQuestion(deps, ava, qid, { reason: "The answer is out of date" });
    const flagged = await adminTriviaList(deps, mod, new URLSearchParams({ status: "FLAGGED" }));
    expect(flagged.counts.FLAGGED).toBe(1);
    expect(flagged.items[0]).toMatchObject({ id: qid, flags: 1, flagReasons: ["The answer is out of date"] });
    await adminUpdateQuestion(deps, mod, qid, { status: "APPROVED" });
    expect((await adminTriviaList(deps, mod, new URLSearchParams({ status: "FLAGGED" }))).counts.FLAGGED).toBe(0);
  });

  it("drafts with AI into the review queue, dropping bad or lyric questions", async () => {
    await expect(adminDraftWithAi(deps, null, mod, { category: "GENRE" })).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    const drafter = {
      draft: async () => [
        { category: "GENRE" as const, prompt: "Which drum machine is famous for its booming kick?", choices: ["TR-808", "LinnDrum", "SP-1200", "MPC60"], answerIndex: 0, explanation: "The 808." },
        { category: "GENRE" as const, prompt: "Complete the lyric from this hook", choices: ["a", "b", "c", "d"], answerIndex: 0 },
        { category: "GENRE" as const, prompt: "Broken question", choices: ["only one"], answerIndex: 0 },
      ],
    };
    const r = await adminDraftWithAi(deps, drafter, mod, { category: "GENRE", genre: "hiphop", count: 3 });
    expect(r).toEqual({ added: 1, skipped: 2 });
    const [row] = await h.db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.source, "AI"));
    expect(row).toMatchObject({ status: "DRAFT", genre: "hiphop" });
    const [{ n }] = (await h.db.execute<{ n: number }>(sql`select count(*)::int as n from trivia_question where status = 'APPROVED' and source = 'AI'`)).rows as [{ n: number }];
    expect(n).toBe(0);
  });
});
