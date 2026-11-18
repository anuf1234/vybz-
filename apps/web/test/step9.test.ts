import { PARTY, normalizePartyCode } from "@vybz/core";
import { type DbHandle, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRow } from "../src/server/battles/service";
import { type PartyDeps, createParty, hostAction, hostView, joinParty, partyAnswer, partyInfo, partySearch, playerView, sweepParties } from "../src/server/party";
import { loadBank } from "../src/server/trivia";
import { TEST_DB_URL, freshDb } from "./helpers";

describe("party codes", () => {
  it("accepts VYBZ-1234, 1234 and spacing", () => {
    expect(normalizePartyCode("VYBZ-4821")).toBe("4821");
    expect(normalizePartyCode("vybz 4821")).toBe("4821");
    expect(normalizePartyCode(" 4821 ")).toBe("4821");
    expect(normalizePartyCode("48")).toBeNull();
    expect(normalizePartyCode("VYBZ-ABCD")).toBeNull();
  });
});

describe.skipIf(!TEST_DB_URL)("step 9: party mode", () => {
  let h: DbHandle;
  let deps: PartyDeps;
  let member: UserRow;
  let code: string;
  let hostKey: string;
  const keys: Record<string, string> = {};

  /** Pushes the party's clock into the past so timed steps are due. */
  const expire = async () => h.db.update(schema.party).set({ deadline: new Date(Date.now() - 1000) }).where(eq(schema.party.code, code));

  beforeAll(async () => {
    h = await freshDb();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    deps = {
      db: h.db,
      catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" },
      requireVerifiedEmail: false,
      aiJudge: null,
      origin: "https://vybz.test",
      trivia: { audioPreviews: false },
    };
    await loadBank(h.db);
    [member] = (await h.db.insert(schema.user).values({ id: "u_mem", name: "Mem", email: "m@x.com", handle: "mem" }).returning()) as [UserRow];
  });
  afterAll(() => h?.close());

  it("hosts a party without an account and lets phones join with a nickname", async () => {
    const c = await createParty(deps, null, { title: "Friday Night R&B", genre: "rnb" }, "1.2.3.4");
    code = c.code;
    hostKey = c.hostKey;
    expect(code).toMatch(/^\d{4}$/);
    const info = await partyInfo(deps, `VYBZ-${code}`);
    expect(info).toMatchObject({ title: "Friday Night R&B", players: 0, open: true });
    await expect(hostView(deps, null, code, "wrong")).rejects.toMatchObject({ code: "NOT_HOST" });

    for (const name of ["Ava", "Ben", "Cleo"]) keys[name] = (await joinParty(deps, null, code, { name })).playerKey;
    await expect(joinParty(deps, null, code, { name: "ava" })).rejects.toMatchObject({ code: "NAME_TAKEN" });
    await expect(joinParty(deps, null, code, { name: "" })).rejects.toMatchObject({ code: "INVALID_NAME" });
    keys.Mem = (await joinParty(deps, member, code, { name: "Mem" })).playerKey;
    // A signed-in player rejoining gets their seat back with a new key.
    const again = await joinParty(deps, member, code, { name: "Whatever" });
    keys.Mem = again.playerKey;

    const v = await hostView(deps, null, code, hostKey);
    expect(v.phase).toBe("LOBBY");
    expect(v.players.map((p) => p.name)).toEqual(["Ava", "Ben", "Cleo", "Mem"]);
    expect(v.joinUrl).toBe(`https://vybz.test/p/${code}`);
    expect(v.qrSvg).toContain("<svg");
    const games = Object.fromEntries(v.games.map((g) => [g.game, g.available]));
    expect(games).toMatchObject({ TRIVIA: true, PLAYLIST: true, NAME_THAT_SONG: false, FINISH_THE_LYRICS: false, DJ_SHOWDOWN: false });
    await expect(hostAction(deps, null, code, hostKey, { action: "start", game: "FINISH_THE_LYRICS" })).rejects.toMatchObject({ code: "GAME_UNAVAILABLE" });
  });

  it("plays music trivia: everyone answers, reveal, scores, next question", async () => {
    let v = await hostAction(deps, null, code, hostKey, { action: "start", game: "TRIVIA", rounds: 5 });
    expect(v).toMatchObject({ phase: "QUESTION", game: "TRIVIA", round: 1, rounds: 5 });
    expect(v.question!.choices).toHaveLength(4);
    const me = await playerView(deps, code, keys.Ava);
    expect(me.question!.prompt).toBe(v.question!.prompt);
    expect(me).not.toHaveProperty("reveal.answerIndex");
    // The right answer, from the database, for the test.
    const [p] = await h.db.select().from(schema.party).where(eq(schema.party.code, code));
    const qid = (p!.data as { questions: string[] }).questions[0]!;
    const [q] = await h.db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.id, qid));
    await partyAnswer(deps, code, keys.Ava, { choice: q!.answerIndex });
    await partyAnswer(deps, code, keys.Ben, { choice: (q!.answerIndex + 1) % 4 });
    await partyAnswer(deps, code, keys.Cleo, { choice: q!.answerIndex });
    // Second answers don't count.
    await partyAnswer(deps, code, keys.Ava, { choice: (q!.answerIndex + 1) % 4 }).catch(() => undefined);
    const last = await partyAnswer(deps, code, keys.Mem, { choice: q!.answerIndex });
    // Everyone online answered: straight to the reveal.
    expect(last.phase).toBe("REVEAL");
    expect(last.myAnswer).toMatchObject({ correct: true });
    expect(last.myAnswer!.points).toBeGreaterThan(100);
    v = await hostView(deps, null, code, hostKey);
    expect(v.reveal!.answerIndex).toBe(q!.answerIndex);
    expect(v.reveal!.counts.reduce((a, b) => a + b, 0)).toBe(4);
    expect(v.reveal!.fastest).toBe("Ava");
    expect(v.standings.find((s) => s.name === "Ben")!.score).toBe(0);
    await expect(partyAnswer(deps, code, keys.Ben, { choice: 0 })).rejects.toMatchObject({ code: "NOT_NOW" });
    await expire();
    v = await hostView(deps, null, code, hostKey);
    expect(v).toMatchObject({ phase: "QUESTION", round: 2 });
    // The host can skip ahead; the rest of the game times out.
    for (let i = 0; i < 8; i++) {
      v = await hostAction(deps, null, code, hostKey, { action: "next" });
      if (v.phase === "SCORES") break;
    }
    expect(v.phase).toBe("SCORES");
    // Signed-in players earn XP; the top scorer earns more.
    const xp = await h.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.userId, member.id));
    expect(xp.map((x) => x.reason)).toContain("PARTY");
    expect(xp.find((x) => x.ref.endsWith(":play"))!.xp).toBe(PARTY.xpPlayed);
  });

  it("plays battle of the playlists: two pick, the rest vote", async () => {
    let v = await hostAction(deps, null, code, hostKey, { action: "start", game: "PLAYLIST", rounds: 1 });
    expect(v.phase).toBe("PICKING");
    const pl = v.playlist!;
    expect(pl.a.song).toBeNull();
    const nameOf = (id: string) => v.players.find((p) => p.id === id)!.name;
    const pickerA = nameOf(pl.a.playerId);
    const pickerB = nameOf(pl.b.playerId);
    const voters = ["Ava", "Ben", "Cleo", "Mem"].filter((n) => n !== pickerA && n !== pickerB);
    await expect(partyAnswer(deps, code, keys[voters[0]!], { catalogId: "VYBZ_DEMO:demo-01" })).rejects.toMatchObject({ code: "NOT_YOUR_TURN" });
    await expect(partySearch(deps, code, "nope", "love")).rejects.toMatchObject({ code: "NOT_IN_PARTY" });
    const hits = await partySearch(deps, code, keys[pickerA]!, "a");
    expect(hits.length).toBeGreaterThan(1);
    const meA = await partyAnswer(deps, code, keys[pickerA]!, { catalogId: hits[0]!.catalogId });
    expect(meA.playlist!.role).toBe("PICKER");
    expect(meA.phase).toBe("PICKING");
    const meB = await partyAnswer(deps, code, keys[pickerB]!, { catalogId: hits[1]!.catalogId });
    expect(meB.phase).toBe("VOTING");
    v = await hostView(deps, null, code, hostKey);
    expect(v.playlist!.a.song!.title).toBe(hits[0]!.title);
    await expect(partyAnswer(deps, code, keys[pickerA]!, { side: "A" })).rejects.toMatchObject({ code: "NOT_YOUR_TURN" });
    await partyAnswer(deps, code, keys[voters[0]!]!, { side: "B" });
    const res = await partyAnswer(deps, code, keys[voters[1]!]!, { side: "B" });
    expect(res.phase).toBe("RESULT");
    expect(res.playlist).toMatchObject({ votes: { a: 0, b: 2 }, winner: "B" });
    await expire();
    v = await hostView(deps, null, code, hostKey);
    expect(v.phase).toBe("SCORES");
    expect(v.standings.find((s) => s.name === pickerB)!.score).toBeGreaterThanOrEqual(2 * PARTY.votePoints);
  });

  it("lets the host kick, end the party and sweeps idle parties", async () => {
    let v = await hostView(deps, null, code, hostKey);
    const cleo = v.players.find((p) => p.name === "Cleo")!;
    v = await hostAction(deps, null, code, hostKey, { action: "kick", playerId: cleo.id });
    expect(v.players.map((p) => p.name)).not.toContain("Cleo");
    await expect(playerView(deps, code, keys.Cleo)).rejects.toMatchObject({ code: "NOT_IN_PARTY" });
    v = await hostAction(deps, null, code, hostKey, { action: "end" });
    expect(v.phase).toBe("FINAL");
    await expect(joinParty(deps, null, code, { name: "Late" })).rejects.toMatchObject({ code: "PARTY_OVER" });
    // The podium stays readable.
    expect((await playerView(deps, code, keys.Ava)).phase).toBe("FINAL");

    const other = await createParty(deps, null, {}, null);
    await h.db.update(schema.party).set({ updatedAt: new Date(Date.now() - PARTY.idleExpiryMs - 1000) }).where(eq(schema.party.code, other.code));
    expect(await sweepParties(deps)).toBe(1);
  });

  it("slows down mass party creation from one address", async () => {
    for (let i = 0; i < 9; i++) await createParty(deps, null, {}, "9.9.9.9");
    await createParty(deps, null, {}, "9.9.9.9");
    await expect(createParty(deps, null, {}, "9.9.9.9")).rejects.toMatchObject({ code: "SLOW_DOWN" });
  });
});
