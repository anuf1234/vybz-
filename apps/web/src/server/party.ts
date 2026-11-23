import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  GENRE_KEYS,
  type CatalogHit,
  PARTY,
  PARTY_GAMES,
  PARTY_PACES,
  type PartyPace,
  PLAYLIST_PROMPTS,
  type PartyCreated,
  type PartyGame,
  type PartyGameOption,
  type PartyHostView,
  type PartyJoined,
  type PartyPhase,
  type PartyPlayerSelfView,
  type PartyPlayerView,
  type PartyPlaylistRound,
  type PartyQuestion,
  type PartySong,
  normalizePartyCode,
  partyCodeLabel,
  triviaPoints,
} from "@vybz/core";
import { type Executor, and, desc, eq, gt, isNull, newId, or, schema, sql } from "@vybz/db";
import QRCode from "qrcode";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { CatalogError, ensureTrack, guestViewer, searchCatalog } from "./catalog";
import { blocklistFromEnv } from "./live";
import { grant, systemIds } from "./progression";
import { ensureTriviaBank, type TriviaOptions } from "./trivia";

/**
 * Vybz Party Mode. A host screen (TV or laptop, holding a secret host key)
 * runs the room; players join from their phones with the code and a
 * nickname (no account needed) and get their own secret key. Everyone polls;
 * the server moves the game on when a timer runs out or everyone's done.
 */

export interface PartyDeps extends BattleDeps {
  origin: string;
  trivia: TriviaOptions;
}

type PartyRow = typeof schema.party.$inferSelect;
type PlayerRow = typeof schema.partyPlayer.$inferSelect;
interface PartyData {
  questions?: string[];
  /** Playlist battles. */
  prompts?: string[];
  turns?: Record<string, number>;
  matchup?: { prompt: string; a: string; b: string };
  /** RESULT of the current matchup. */
  outcome?: { a: number; b: number; winner: "A" | "B" | "DRAW" };
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const newKey = () => randomBytes(24).toString("base64url");
const ONLINE_MS = 15_000;

function cleanName(raw: unknown, max: number, what: string): string {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!text || text.length > max) throw new ServiceError(400, "INVALID_NAME", `${what} must be 1–${max} characters.`);
  const lower = text.toLowerCase();
  if (blocklistFromEnv().some((w) => w && lower.includes(w))) throw new ServiceError(400, "NAME_BLOCKED", "Pick a different name.");
  if (/https?:|www\./i.test(text)) throw new ServiceError(400, "NAME_BLOCKED", "Pick a different name.");
  return text;
}

// ── Rooms ──────────────────────────────────────────────────────────────────

export async function createParty(deps: PartyDeps, viewer: UserRow | null, body: unknown, ip: string | null): Promise<PartyCreated> {
  const b = (body ?? {}) as { title?: unknown; genre?: unknown };
  const title = b.title === undefined || b.title === "" ? "VYBZ Party" : cleanName(b.title, PARTY.titleMax, "The party name");
  const genre = typeof b.genre === "string" && b.genre ? b.genre : null;
  if (genre && !(GENRE_KEYS as string[]).includes(genre)) throw new ServiceError(400, "INVALID_GENRE");
  const ipHash = ip ? hash(`party:${ip}`) : null;
  if (ipHash) {
    const [{ n }] = (await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.party)
      .where(and(eq(schema.party.ipHash, ipHash), gt(schema.party.createdAt, new Date(Date.now() - 3600_000))))) as [{ n: number }];
    if (n >= 10) throw new ServiceError(429, "SLOW_DOWN", "That's a lot of parties. Try again in a while.");
  }
  const hostKey = newKey();
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = String(attempt < 20 ? randomInt(1000, 10000) : randomInt(10000, 100000));
    const [row] = await deps.db
      .insert(schema.party)
      .values({ id: newId(), code, title, genre, hostUserId: viewer?.id ?? null, hostKeyHash: hash(hostKey), ipHash })
      .onConflictDoNothing()
      .returning({ code: schema.party.code });
    if (row) return { code: row.code, hostKey };
  }
  throw new ServiceError(503, "TRY_AGAIN");
}

/** The live party for a code (or one that ended in the last 2 hours, so the podium stays up). */
async function partyByCode(db: Executor, raw: string): Promise<PartyRow> {
  const code = normalizePartyCode(raw);
  if (!code) throw new ServiceError(404, "PARTY_NOT_FOUND", "No party with that code.");
  const [row] = await db
    .select()
    .from(schema.party)
    .where(and(eq(schema.party.code, code), or(isNull(schema.party.endedAt), gt(schema.party.endedAt, new Date(Date.now() - 2 * 3600_000)))))
    .orderBy(desc(schema.party.createdAt))
    .limit(1);
  if (!row || (!row.endedAt && Date.now() - row.updatedAt.getTime() > PARTY.idleExpiryMs)) throw new ServiceError(404, "PARTY_NOT_FOUND", "No party with that code.");
  return row;
}

function checkHost(p: PartyRow, key: unknown, viewer: UserRow | null) {
  if ((typeof key === "string" && key && hash(key) === p.hostKeyHash) || (viewer && p.hostUserId === viewer.id)) return;
  throw new ServiceError(403, "NOT_HOST", "Only the host can do that.");
}

async function playerByKey(db: Executor, p: PartyRow, key: unknown): Promise<PlayerRow> {
  if (typeof key !== "string" || !key) throw new ServiceError(401, "NOT_IN_PARTY", "Join the party first.");
  const [row] = await db
    .select()
    .from(schema.partyPlayer)
    .where(and(eq(schema.partyPlayer.partyId, p.id), eq(schema.partyPlayer.keyHash, hash(key))));
  if (!row || row.removed) throw new ServiceError(401, "NOT_IN_PARTY", "Join the party first.");
  return row;
}

export async function joinParty(deps: PartyDeps, viewer: UserRow | null, code: string, body: unknown): Promise<PartyJoined> {
  const p = await partyByCode(deps.db, code);
  if (p.endedAt || p.phase === "FINAL") throw new ServiceError(409, "PARTY_OVER", "This party has ended.");
  const name = cleanName((body as { name?: unknown } | null)?.name, PARTY.nameMax, "Your name");
  const playerKey = newKey();
  // Signed-in people rejoining (new phone, cleared browser) get their seat back.
  if (viewer) {
    const [mine] = await deps.db
      .update(schema.partyPlayer)
      .set({ keyHash: hash(playerKey), lastSeenAt: new Date() })
      .where(and(eq(schema.partyPlayer.partyId, p.id), eq(schema.partyPlayer.userId, viewer.id), eq(schema.partyPlayer.removed, false)))
      .returning();
    if (mine) return { code: p.code, playerId: mine.id, playerKey };
  }
  if (p.locked) throw new ServiceError(409, "PARTY_LOCKED", "The host closed this party to new players.");
  const [{ n }] = (await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.partyPlayer)
    .where(and(eq(schema.partyPlayer.partyId, p.id), eq(schema.partyPlayer.removed, false)))) as [{ n: number }];
  if (n >= PARTY.maxPlayers) throw new ServiceError(409, "PARTY_FULL", `This party is full (${PARTY.maxPlayers} players).`);
  const [row] = await deps.db
    .insert(schema.partyPlayer)
    .values({ id: newId(), partyId: p.id, name, userId: viewer && !viewer.isSystem ? viewer.id : null, keyHash: hash(playerKey) })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new ServiceError(409, "NAME_TAKEN", "Someone here already has that name. Try another.");
  await touch(deps.db, p.id);
  return { code: p.code, playerId: row.id, playerKey };
}

async function touch(db: Executor, partyId: string) {
  await db.update(schema.party).set({ updatedAt: new Date() }).where(eq(schema.party.id, partyId));
}

// ── Games ──────────────────────────────────────────────────────────────────

async function activePlayers(db: Executor, partyId: string): Promise<PlayerRow[]> {
  return db.select().from(schema.partyPlayer).where(and(eq(schema.partyPlayer.partyId, partyId), eq(schema.partyPlayer.removed, false))).orderBy(schema.partyPlayer.joinedAt);
}

const isOnline = (pl: PlayerRow, now = Date.now()) => now - pl.lastSeenAt.getTime() < ONLINE_MS;

async function gameOptions(deps: PartyDeps, p: PartyRow, players: number): Promise<PartyGameOption[]> {
  await ensureTriviaBank(deps.db);
  const q = schema.triviaQuestion;
  const counts = await deps.db
    .select({ song: sql<boolean>`${q.category} = 'GUESS_SONG'`, n: sql<number>`count(*)::int` })
    .from(q)
    .where(eq(q.status, "APPROVED"))
    .groupBy(sql`1`);
  const songs = counts.find((c) => c.song)?.n ?? 0;
  const trivia = counts.find((c) => !c.song)?.n ?? 0;
  const opt = (game: PartyGame, available: boolean, reason: string | null, rounds: readonly number[]): PartyGameOption => ({ game, ...PARTY_GAMES[game], available, reason, rounds });
  void p;
  return [
    opt("TRIVIA", trivia >= 5, trivia >= 5 ? null : "Not enough trivia questions yet.", PARTY.triviaRounds),
    opt("PLAYLIST", players >= 3, players >= 3 ? null : "Needs at least 3 players: 2 to pick, the rest to vote.", PARTY.playlistRounds),
    opt(
      "NAME_THAT_SONG",
      deps.trivia.audioPreviews && songs >= 5,
      !deps.trivia.audioPreviews ? "Needs licensed audio clips. Not switched on yet." : songs >= 5 ? null : "Not enough songs with clips yet.",
      PARTY.triviaRounds,
    ),
    opt("FINISH_THE_LYRICS", false, "Needs a lyrics licence. Coming once VYBZ has one.", []),
    opt("DJ_SHOWDOWN", false, "Coming soon. Try DJ battles in the app.", []),
  ];
}

async function pickQuestions(deps: PartyDeps, genre: string | null, songs: boolean, n: number): Promise<string[]> {
  const q = schema.triviaQuestion;
  const base = and(eq(q.status, "APPROVED"), songs ? eq(q.category, "GUESS_SONG") : sql`${q.category} <> 'GUESS_SONG'`)!;
  const take = async (cond: ReturnType<typeof and>, exclude: string[], k: number) =>
    k <= 0
      ? []
      : deps.db
          .select({ id: q.id, d: q.difficulty })
          .from(q)
          .where(and(cond, exclude.length ? sql`${q.id} <> all(${exclude})` : sql`true`))
          .orderBy(sql`random()`)
          .limit(k);
  const themed = genre ? await take(and(base, eq(q.genre, genre)), [], n) : [];
  const rest = await take(base, themed.map((t) => t.id), n - themed.length);
  return [...themed, ...rest].sort((a, b) => a.d - b.d).map((r) => r.id);
}

export async function hostAction(deps: PartyDeps, viewer: UserRow | null, code: string, key: unknown, body: unknown): Promise<PartyHostView> {
  const p0 = await partyByCode(deps.db, code);
  checkHost(p0, key, viewer);
  const b = (body ?? {}) as { action?: unknown; game?: unknown; rounds?: unknown; playerId?: unknown; title?: unknown; genre?: unknown };
  const now = new Date();
  const players = await activePlayers(deps.db, p0.id);
  let finished: { gameNo: number } | null = null;

  await deps.db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.party).where(eq(schema.party.id, p0.id)).for("update");
    if (!p) throw new ServiceError(404, "PARTY_NOT_FOUND");
    if (p.phase === "FINAL") throw new ServiceError(409, "PARTY_OVER", "This party has ended.");
    switch (b.action) {
      case "settings": {
        if (p.phase !== "LOBBY" && p.phase !== "SCORES") throw new ServiceError(409, "NOT_NOW");
        const title = b.title === undefined ? p.title : cleanName(b.title, PARTY.titleMax, "The party name");
        const genre = b.genre === undefined ? p.genre : typeof b.genre === "string" && b.genre ? b.genre : null;
        if (genre && !(GENRE_KEYS as string[]).includes(genre)) throw new ServiceError(400, "INVALID_GENRE");
        await tx.update(schema.party).set({ title, genre }).where(eq(schema.party.id, p.id));
        return;
      }
      case "start": {
        if (p.phase !== "LOBBY" && p.phase !== "SCORES") throw new ServiceError(409, "NOT_NOW", "Finish this game first.");
        const game = b.game as PartyGame;
        const opt = (await gameOptions(deps, p, players.length)).find((o) => o.game === game);
        if (!opt) throw new ServiceError(400, "INVALID_GAME");
        if (!opt.available) throw new ServiceError(409, "GAME_UNAVAILABLE", opt.reason ?? "That game isn't available.");
        if (players.length < 1) throw new ServiceError(409, "NO_PLAYERS", "Wait for someone to join.");
        const want = Number(b.rounds) || opt.rounds[0]!;
        if (!opt.rounds.includes(want)) throw new ServiceError(400, "INVALID_ROUNDS");
        const gameNo = p.gameNo + 1;
        if (game === "PLAYLIST") {
          const prompts = [...PLAYLIST_PROMPTS].sort(() => Math.random() - 0.5).slice(0, want);
          const data: PartyData = { prompts, turns: {} };
          data.matchup = nextMatchup(players, data, 0);
          await tx
            .update(schema.party)
            .set({ game, gameNo, round: 1, rounds: want, phase: "PICKING", deadline: new Date(now.getTime() + paced(p, PARTY.pickMs)), pausedLeftMs: null, data })
            .where(eq(schema.party.id, p.id));
        } else {
          const questions = await pickQuestions(deps, p.genre, game === "NAME_THAT_SONG", want);
          if (questions.length < 3) throw new ServiceError(409, "GAME_UNAVAILABLE", "Not enough questions for that yet.");
          await tx
            .update(schema.party)
            .set({ game, gameNo, round: 1, rounds: questions.length, phase: "QUESTION", deadline: new Date(now.getTime() + paced(p, PARTY.questionMs)), pausedLeftMs: null, data: { questions } })
            .where(eq(schema.party.id, p.id));
        }
        return;
      }
      case "next": {
        if (p.pausedLeftMs !== null) await tx.update(schema.party).set({ pausedLeftMs: null }).where(eq(schema.party.id, p.id));
        const r = await step(tx, deps, { ...p, pausedLeftMs: null }, players, now, true);
        if (r) finished = r;
        return;
      }
      case "lobby":
        if (p.phase !== "SCORES") throw new ServiceError(409, "NOT_NOW");
        await tx.update(schema.party).set({ phase: "LOBBY", game: null, round: 0, rounds: 0, deadline: null, data: {} }).where(eq(schema.party.id, p.id));
        return;
      case "end": {
        if (p.phase !== "LOBBY" && p.phase !== "SCORES") finished = { gameNo: p.gameNo };
        await tx.update(schema.party).set({ phase: "FINAL", deadline: null, endedAt: now }).where(eq(schema.party.id, p.id));
        return;
      }
      case "pause": {
        if (!p.deadline || p.pausedLeftMs !== null) throw new ServiceError(409, "NOT_NOW", "Nothing's running to pause.");
        await tx.update(schema.party).set({ pausedLeftMs: Math.max(1000, p.deadline.getTime() - now.getTime()), deadline: null }).where(eq(schema.party.id, p.id));
        return;
      }
      case "resume": {
        if (p.pausedLeftMs === null) throw new ServiceError(409, "NOT_NOW");
        await tx.update(schema.party).set({ deadline: new Date(now.getTime() + p.pausedLeftMs), pausedLeftMs: null }).where(eq(schema.party.id, p.id));
        return;
      }
      case "streamsafe":
        await tx.update(schema.party).set({ streamSafe: (b as { on?: unknown }).on === true }).where(eq(schema.party.id, p.id));
        return;
      case "lock":
      case "unlock":
        await tx.update(schema.party).set({ locked: b.action === "lock" }).where(eq(schema.party.id, p.id));
        return;
      case "pace": {
        const pace = (b as { pace?: unknown }).pace;
        if (typeof pace !== "string" || !(pace in PARTY_PACES)) throw new ServiceError(400, "INVALID_PACE");
        await tx.update(schema.party).set({ pace: pace as PartyPace }).where(eq(schema.party.id, p.id));
        return;
      }
      case "kick": {
        if (typeof b.playerId !== "string") throw new ServiceError(400, "INVALID_PLAYER");
        await tx.update(schema.partyPlayer).set({ removed: true }).where(and(eq(schema.partyPlayer.id, b.playerId), eq(schema.partyPlayer.partyId, p.id)));
        return;
      }
      default:
        throw new ServiceError(400, "INVALID_ACTION");
    }
  });
  if (finished) await rewardGame(deps, p0.id, (finished as { gameNo: number }).gameNo);
  return hostView(deps, viewer, code, key);
}

/** Two players for the next playlist battle: the ones who've picked least, at random among equals. */
function nextMatchup(players: PlayerRow[], data: PartyData, index: number): PartyData["matchup"] {
  const online = players.filter((pl) => isOnline(pl)).length >= 3 ? players.filter((pl) => isOnline(pl)) : players;
  const turns = data.turns ?? {};
  const order = [...online].sort((a, b) => (turns[a.id] ?? 0) - (turns[b.id] ?? 0) || Math.random() - 0.5);
  const [a, b] = order;
  if (!a || !b) return undefined;
  turns[a.id] = (turns[a.id] ?? 0) + 1;
  turns[b.id] = (turns[b.id] ?? 0) + 1;
  data.turns = turns;
  return { prompt: data.prompts?.[index] ?? PLAYLIST_PROMPTS[index % PLAYLIST_PROMPTS.length]!, a: a.id, b: b.id };
}

/** A phase's length at this party's pace. */
const paced = (p: Pick<PartyRow, "pace">, ms: number) => Math.round(ms * (PARTY_PACES[p.pace as PartyPace] ?? 1));

const stepKey = (p: PartyRow, kind: "q" | "pick" | "vote") => `${p.gameNo}:${p.round}:${kind}`;

/**
 * Moves the game on one step if its time is up, everyone's done, or the host
 * pressed Next (`force`). Runs inside a transaction holding the party row.
 * Returns the game number when a game just finished.
 */
async function step(tx: Executor, deps: PartyDeps, p: PartyRow, players: PlayerRow[], now: Date, force: boolean): Promise<{ gameNo: number } | null> {
  const due = !!p.deadline && p.deadline.getTime() <= now.getTime();
  const data = (p.data ?? {}) as PartyData;
  const set = (v: Partial<typeof schema.party.$inferInsert>) => tx.update(schema.party).set(v).where(eq(schema.party.id, p.id));
  const answersFor = (kind: "q" | "pick" | "vote") => tx.select().from(schema.partyAnswer).where(and(eq(schema.partyAnswer.partyId, p.id), eq(schema.partyAnswer.step, stepKey(p, kind))));
  const after = (ms: number) => new Date(now.getTime() + paced(p, ms));
  // Paused: nothing moves on its own; the host's Next still does.
  if (p.pausedLeftMs !== null && !force) return null;

  switch (p.phase as PartyPhase) {
    case "QUESTION": {
      const answers = await answersFor("q");
      const waitingOn = players.filter((pl) => isOnline(pl, now.getTime()) && !answers.some((a) => a.playerId === pl.id));
      if (!due && !force && (waitingOn.length || !answers.length)) return null;
      await set({ phase: "REVEAL", deadline: after(PARTY.revealMs) });
      return null;
    }
    case "REVEAL":
    case "RESULT": {
      if (!due && !force) return null;
      if (p.round >= p.rounds) {
        await set({ phase: "SCORES", deadline: null });
        return { gameNo: p.gameNo };
      }
      if (p.game === "PLAYLIST") {
        const fresh = { ...data, outcome: undefined };
        fresh.matchup = nextMatchup(players, fresh, p.round);
        await set({ round: p.round + 1, phase: "PICKING", deadline: after(PARTY.pickMs), data: fresh });
      } else {
        await set({ round: p.round + 1, phase: "QUESTION", deadline: after(PARTY.questionMs) });
      }
      return null;
    }
    case "PICKING": {
      const picks = await answersFor("pick");
      const m = data.matchup;
      const hasA = picks.some((x) => x.playerId === m?.a);
      const hasB = picks.some((x) => x.playerId === m?.b);
      if (!due && !force && !(hasA && hasB)) return null;
      if (m && hasA && hasB) {
        await set({ phase: "VOTING", deadline: after(PARTY.voteMs) });
      } else {
        // A no-show forfeits; nobody picking means nobody scores.
        const winner = hasA ? "A" : hasB ? "B" : "DRAW";
        if (m && winner !== "DRAW") {
          const id = winner === "A" ? m.a : m.b;
          await tx.update(schema.partyPlayer).set({ score: sql`${schema.partyPlayer.score} + ${PARTY.votePoints}` }).where(eq(schema.partyPlayer.id, id));
          await tx.update(schema.partyAnswer).set({ points: PARTY.votePoints }).where(and(eq(schema.partyAnswer.partyId, p.id), eq(schema.partyAnswer.step, stepKey(p, "pick")), eq(schema.partyAnswer.playerId, id)));
        }
        await set({ phase: "RESULT", deadline: after(PARTY.resultMs), data: { ...data, outcome: { a: 0, b: 0, winner } } });
      }
      return null;
    }
    case "VOTING": {
      const votes = await answersFor("vote");
      const m = data.matchup!;
      const voters = players.filter((pl) => pl.id !== m.a && pl.id !== m.b && isOnline(pl, now.getTime()));
      const allIn = voters.length > 0 && voters.every((v) => votes.some((x) => x.playerId === v.id));
      if (!due && !force && !allIn) return null;
      const a = votes.filter((v) => (v.value as { side: string }).side === "A").length;
      const bb = votes.length - a;
      for (const [id, n] of [
        [m.a, a],
        [m.b, bb],
      ] as const) {
        if (!n) continue;
        await tx.update(schema.partyPlayer).set({ score: sql`${schema.partyPlayer.score} + ${n * PARTY.votePoints}` }).where(eq(schema.partyPlayer.id, id));
        await tx
          .update(schema.partyAnswer)
          .set({ points: n * PARTY.votePoints })
          .where(and(eq(schema.partyAnswer.partyId, p.id), eq(schema.partyAnswer.step, stepKey(p, "pick")), eq(schema.partyAnswer.playerId, id)));
      }
      await set({ phase: "RESULT", deadline: after(PARTY.resultMs), data: { ...data, outcome: { a, b: bb, winner: a > bb ? "A" : bb > a ? "B" : "DRAW" } } });
      return null;
    }
    default:
      return null;
  }
}

/** Moves the game along if it's due. Cheap when nothing's due; locks the row only when something is. */
async function advance(deps: PartyDeps, p: PartyRow): Promise<void> {
  const timed = ["QUESTION", "REVEAL", "PICKING", "VOTING", "RESULT"].includes(p.phase);
  if (!timed) return;
  for (let i = 0; i < 4; i++) {
    let finished: { gameNo: number } | null = null;
    let moved = false;
    await deps.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(schema.party).where(eq(schema.party.id, p.id)).for("update");
      if (!cur) return;
      const players = await activePlayers(tx, p.id);
      const before = `${cur.phase}:${cur.round}`;
      finished = await step(tx, deps, cur, players, new Date(), false);
      const [after] = await tx.select({ phase: schema.party.phase, round: schema.party.round }).from(schema.party).where(eq(schema.party.id, p.id));
      moved = `${after!.phase}:${after!.round}` !== before;
    });
    if (finished) await rewardGame(deps, p.id, (finished as { gameNo: number }).gameNo);
    if (!moved) return;
  }
}

/** XP for signed-in players: something for playing, more for the game's top scorer. Once per game. */
async function rewardGame(deps: PartyDeps, partyId: string, gameNo: number): Promise<void> {
  try {
    const rows = await deps.db
      .select({ playerId: schema.partyAnswer.playerId, userId: schema.partyPlayer.userId, pts: sql<number>`sum(${schema.partyAnswer.points})::int` })
      .from(schema.partyAnswer)
      .innerJoin(schema.partyPlayer, eq(schema.partyPlayer.id, schema.partyAnswer.playerId))
      .where(and(eq(schema.partyAnswer.partyId, partyId), sql`${schema.partyAnswer.step} like ${`${gameNo}:%`}`))
      .groupBy(schema.partyAnswer.playerId, schema.partyPlayer.userId);
    const top = Math.max(0, ...rows.map((r) => r.pts));
    const members = rows.filter((r): r is typeof r & { userId: string } => !!r.userId);
    const system = await systemIds(deps.db, members.map((m) => m.userId));
    for (const m of members) {
      if (system.has(m.userId)) continue;
      await grant(deps.db, m.userId, "PARTY", `${partyId}:${gameNo}:play`, { xp: PARTY.xpPlayed, coins: 0 });
      if (top > 0 && m.pts === top) await grant(deps.db, m.userId, "PARTY", `${partyId}:${gameNo}:win`, { xp: PARTY.xpWon, coins: PARTY.coinsWon });
    }
  } catch (err) {
    console.error("party rewards failed", err);
  }
}

// ── Playing ────────────────────────────────────────────────────────────────

/** Song search for pickers (needs a player key, so it isn't an open search proxy). */
export async function partySearch(deps: PartyDeps, code: string, key: unknown, q: string): Promise<CatalogHit[]> {
  const p = await partyByCode(deps.db, code);
  await playerByKey(deps.db, p, key);
  const query = q.trim().slice(0, 100);
  if (!query) return [];
  if (!deps.catalog.metadata.length) throw new ServiceError(503, "NO_PROVIDERS_CONFIGURED");
  return searchCatalog(deps.catalog, query, guestViewer(deps.catalog.storefront));
}

export async function partyAnswer(deps: PartyDeps, code: string, key: unknown, body: unknown): Promise<PartyPlayerSelfView> {
  const p = await partyByCode(deps.db, code);
  await advance(deps, p);
  const me = await playerByKey(deps.db, p, key);
  const b = (body ?? {}) as { choice?: unknown; catalogId?: unknown; side?: unknown };
  const now = new Date();
  const [cur] = await deps.db.select().from(schema.party).where(eq(schema.party.id, p.id));
  const data = (cur!.data ?? {}) as PartyData;
  if (cur!.phase === "QUESTION") {
    const choice = Number(b.choice);
    const qid = data.questions?.[cur!.round - 1];
    if (!qid || !Number.isInteger(choice) || choice < 0 || choice > 5) throw new ServiceError(400, "INVALID_ANSWER");
    const [q] = await deps.db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.id, qid));
    if (!cur!.deadline) throw new ServiceError(409, "PAUSED", "The host paused the game.");
    const ms = Math.max(0, paced(cur!, PARTY.questionMs) - (cur!.deadline.getTime() - now.getTime()));
    const correct = choice === q!.answerIndex;
    // Speed points scale with the pace, so a relaxed party isn't a low-scoring one.
    const points = triviaPoints(correct, ms / (PARTY_PACES[cur!.pace as PartyPace] ?? 1));
    await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.partyAnswer)
        .values({ partyId: p.id, step: stepKey(cur!, "q"), playerId: me.id, value: { choice, correct }, points, ms })
        .onConflictDoNothing()
        .returning();
      if (row && points) await tx.update(schema.partyPlayer).set({ score: sql`${schema.partyPlayer.score} + ${points}` }).where(eq(schema.partyPlayer.id, me.id));
    });
  } else if (cur!.phase === "PICKING") {
    const m = data.matchup;
    if (!m || (me.id !== m.a && me.id !== m.b)) throw new ServiceError(403, "NOT_YOUR_TURN", "You're voting this round.");
    if (typeof b.catalogId !== "string") throw new ServiceError(400, "INVALID_PICK");
    let song: PartySong;
    try {
      const st = await ensureTrack(deps.db, deps.catalog, b.catalogId);
      // Enough to play it on the big screen: a preview, and the Apple Music and YouTube ids.
      const apple = st.refs.find((r) => r.provider === "APPLE_MUSIC");
      const yt = st.refs.find((r) => r.provider === "YOUTUBE");
      song = {
        title: st.track.title,
        artistName: st.track.artistName,
        albumName: st.track.albumName,
        releaseYear: st.track.releaseYear,
        artworkUrl: st.track.artworkUrl,
        previewUrl: (apple ?? st.refs.find((r) => r.previewUrl))?.previewUrl ?? null,
        appleId: apple?.externalId ?? null,
        youtubeId: yt?.externalId ?? null,
      };
    } catch (err) {
      if (err instanceof CatalogError) throw new ServiceError(400, "INVALID_PICK", "Couldn't find that song. Try another.");
      throw err;
    }
    await deps.db
      .insert(schema.partyAnswer)
      .values({ partyId: p.id, step: stepKey(cur!, "pick"), playerId: me.id, value: { song } })
      .onConflictDoUpdate({ target: [schema.partyAnswer.partyId, schema.partyAnswer.step, schema.partyAnswer.playerId], set: { value: { song }, createdAt: now } });
  } else if (cur!.phase === "VOTING") {
    const m = data.matchup!;
    if (me.id === m.a || me.id === m.b) throw new ServiceError(403, "NOT_YOUR_TURN", "You can't vote on your own battle.");
    if (b.side !== "A" && b.side !== "B") throw new ServiceError(400, "INVALID_VOTE");
    await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.partyAnswer)
        .values({ partyId: p.id, step: stepKey(cur!, "vote"), playerId: me.id, value: { side: b.side }, points: PARTY.voterPoints })
        .onConflictDoNothing()
        .returning();
      if (row) await tx.update(schema.partyPlayer).set({ score: sql`${schema.partyPlayer.score} + ${PARTY.voterPoints}` }).where(eq(schema.partyPlayer.id, me.id));
    });
  } else {
    throw new ServiceError(409, "NOT_NOW", "Hang on for the next round.");
  }
  await advance(deps, (await deps.db.select().from(schema.party).where(eq(schema.party.id, p.id)))[0]!);
  return playerView(deps, code, key);
}

// ── Views ──────────────────────────────────────────────────────────────────

function standings(players: PlayerRow[], doneIds: Set<string>, now: number): PartyPlayerView[] {
  return [...players]
    .sort((a, b) => b.score - a.score || a.joinedAt.getTime() - b.joinedAt.getTime())
    .map((pl) => ({ id: pl.id, name: pl.name, score: pl.score, online: isOnline(pl, now), done: doneIds.has(pl.id), isMember: !!pl.userId }));
}

async function roundState(deps: PartyDeps, p: PartyRow) {
  const data = (p.data ?? {}) as PartyData;
  const players = await activePlayers(deps.db, p.id);
  let question: PartyQuestion | null = null;
  let answerIndex: number | null = null;
  let explanation: string | null = null;
  let answers: (typeof schema.partyAnswer.$inferSelect)[] = [];
  let playlist: PartyPlaylistRound | null = null;
  let doneKind: "q" | "pick" | "vote" | null = null;
  if ((p.phase === "QUESTION" || p.phase === "REVEAL") && data.questions) {
    const qid = data.questions[p.round - 1];
    const [q] = qid ? await deps.db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.id, qid)) : [];
    if (q) {
      let imageUrl: string | null = null;
      let audioUrl: string | null = null;
      if (q.trackId && q.category === "ALBUM_ART") imageUrl = (await deps.db.select({ a: schema.track.artworkUrl }).from(schema.track).where(eq(schema.track.id, q.trackId)))[0]?.a ?? null;
      if (q.trackId && q.category === "GUESS_SONG" && deps.trivia.audioPreviews) {
        const refs = await deps.db.select().from(schema.trackProviderRef).where(eq(schema.trackProviderRef.trackId, q.trackId));
        audioUrl = (refs.find((r) => r.provider === "APPLE_MUSIC" && r.previewUrl) ?? refs.find((r) => r.previewUrl))?.previewUrl ?? null;
      }
      question = { prompt: q.prompt, choices: q.choices, imageUrl, audioUrl, category: q.category };
      answerIndex = q.answerIndex;
      explanation = q.explanation;
    }
    doneKind = "q";
  }
  if (p.game === "PLAYLIST" && data.matchup && ["PICKING", "VOTING", "RESULT"].includes(p.phase)) {
    const m = data.matchup;
    const picks = await deps.db
      .select()
      .from(schema.partyAnswer)
      .where(and(eq(schema.partyAnswer.partyId, p.id), eq(schema.partyAnswer.step, stepKey(p, "pick"))));
    const songOf = (id: string) => ((picks.find((x) => x.playerId === id)?.value as { song?: PartySong } | undefined)?.song ?? null);
    const nameOf = (id: string) => players.find((pl) => pl.id === id)?.name ?? "Someone";
    // Picks stay secret until voting starts.
    const show = p.phase !== "PICKING";
    playlist = {
      prompt: m.prompt,
      a: { playerId: m.a, name: nameOf(m.a), song: show ? songOf(m.a) : null },
      b: { playerId: m.b, name: nameOf(m.b), song: show ? songOf(m.b) : null },
      votes: p.phase === "RESULT" && data.outcome ? { a: data.outcome.a, b: data.outcome.b } : null,
      winner: p.phase === "RESULT" ? (data.outcome?.winner ?? null) : null,
    };
    doneKind = p.phase === "PICKING" ? "pick" : p.phase === "VOTING" ? "vote" : null;
  }
  if (doneKind) {
    answers = await deps.db
      .select()
      .from(schema.partyAnswer)
      .where(and(eq(schema.partyAnswer.partyId, p.id), eq(schema.partyAnswer.step, stepKey(p, doneKind))));
  }
  return { data, players, question, answerIndex, explanation, answers, playlist };
}

export async function hostView(deps: PartyDeps, viewer: UserRow | null, code: string, key: unknown): Promise<PartyHostView> {
  let p = await partyByCode(deps.db, code);
  checkHost(p, key, viewer);
  await advance(deps, p);
  p = (await deps.db.select().from(schema.party).where(eq(schema.party.id, p.id)))[0]!;
  const r = await roundState(deps, p);
  const now = Date.now();
  const joinUrl = `${deps.origin}/p/${p.code}`;
  const counts = r.question ? r.question.choices.map((_, i) => r.answers.filter((a) => (a.value as { choice: number }).choice === i).length) : [];
  const fastest = p.phase === "REVEAL" ? [...r.answers].filter((a) => (a.value as { correct: boolean }).correct).sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0))[0] : undefined;
  const st = standings(r.players, new Set(r.answers.map((a) => a.playerId)), now);
  return {
    code: p.code,
    title: p.title,
    genre: p.genre,
    phase: p.phase,
    game: p.game,
    round: p.round,
    rounds: p.rounds,
    deadline: p.deadline?.toISOString() ?? null,
    serverNow: new Date(now).toISOString(),
    standings: st,
    paused: p.pausedLeftMs !== null,
    locked: p.locked,
    pace: p.pace as PartyPace,
    streamSafe: p.streamSafe,
    joinUrl,
    qrSvg: await QRCode.toString(joinUrl, { type: "svg", margin: 1, color: { dark: "#0A0614", light: "#FFFFFF" } }),
    players: st,
    question: r.question,
    reveal: p.phase === "REVEAL" && r.answerIndex !== null ? { answerIndex: r.answerIndex, counts, explanation: r.explanation, fastest: fastest ? (r.players.find((pl) => pl.id === fastest.playerId)?.name ?? null) : null } : null,
    playlist: r.playlist,
    games: await gameOptions(deps, p, r.players.length),
    answered: r.answers.length,
  };
}

export async function playerView(deps: PartyDeps, code: string, key: unknown): Promise<PartyPlayerSelfView> {
  let p = await partyByCode(deps.db, code);
  await advance(deps, p);
  p = (await deps.db.select().from(schema.party).where(eq(schema.party.id, p.id)))[0]!;
  const me = await playerByKey(deps.db, p, key);
  await deps.db.update(schema.partyPlayer).set({ lastSeenAt: new Date() }).where(eq(schema.partyPlayer.id, me.id));
  const r = await roundState(deps, p);
  const now = Date.now();
  const st = standings(r.players, new Set(r.answers.map((a) => a.playerId)), now);
  const mine = r.answers.find((a) => a.playerId === me.id);
  const meRow = st.find((s) => s.id === me.id)!;
  const reveal = p.phase === "REVEAL" && r.answerIndex !== null;
  let myAnswer: PartyPlayerSelfView["myAnswer"] = null;
  if (r.question && mine) {
    const v = mine.value as { choice: number; correct: boolean };
    myAnswer = { choice: v.choice, correct: reveal ? v.correct : null, points: reveal ? mine.points : null };
  } else if (r.question && reveal) {
    myAnswer = { choice: null, correct: false, points: 0 };
  }
  let playlist: PartyPlayerSelfView["playlist"] = null;
  if (r.playlist) {
    const mySide = r.playlist.a.playerId === me.id ? "A" : r.playlist.b.playerId === me.id ? "B" : null;
    const myVoteRow = p.phase === "VOTING" ? mine : undefined;
    // Pickers see their own pick while picking.
    const own = mySide && p.phase === "PICKING" ? ((mine?.value as { song?: PartySong } | undefined)?.song ?? null) : null;
    playlist = {
      ...r.playlist,
      ...(own && mySide === "A" ? { a: { ...r.playlist.a, song: own } } : {}),
      ...(own && mySide === "B" ? { b: { ...r.playlist.b, song: own } } : {}),
      role: mySide ? "PICKER" : "VOTER",
      mySide,
      myVote: myVoteRow ? ((myVoteRow.value as { side: "A" | "B" }).side ?? null) : null,
    };
  }
  return {
    code: p.code,
    title: p.title,
    genre: p.genre,
    phase: p.phase,
    game: p.game,
    round: p.round,
    rounds: p.rounds,
    deadline: p.deadline?.toISOString() ?? null,
    serverNow: new Date(now).toISOString(),
    standings: st.slice(0, 10),
    paused: p.pausedLeftMs !== null,
    locked: p.locked,
    pace: p.pace as PartyPace,
    streamSafe: p.streamSafe,
    me: { id: me.id, name: me.name, score: meRow.score, rank: st.findIndex((s) => s.id === me.id) + 1 },
    question: r.question
      ? { prompt: r.question.prompt, choices: r.question.choices, imageUrl: r.question.imageUrl, category: r.question.category, ...(p.streamSafe ? { audioUrl: r.question.audioUrl } : {}) }
      : null,
    myAnswer,
    reveal: reveal ? { answerIndex: r.answerIndex! } : null,
    playlist,
  };
}

/** Public: does this code exist (for the join screen)? */
export async function partyInfo(deps: PartyDeps, code: string): Promise<{ code: string; label: string; title: string; players: number; open: boolean }> {
  const p = await partyByCode(deps.db, code);
  const players = await activePlayers(deps.db, p.id);
  return { code: p.code, label: partyCodeLabel(p.code), title: p.title, players: players.length, open: !p.endedAt && p.phase !== "FINAL" && players.length < PARTY.maxPlayers };
}

/** Housekeeping from the scheduler: ends idle parties, deletes old ones. */
export async function sweepParties(deps: Pick<PartyDeps, "db">): Promise<number> {
  const idle = new Date(Date.now() - PARTY.idleExpiryMs);
  const ended = await deps.db
    .update(schema.party)
    .set({ phase: "FINAL", endedAt: new Date() })
    .where(and(isNull(schema.party.endedAt), sql`${schema.party.updatedAt} < ${idle}`))
    .returning({ id: schema.party.id });
  await deps.db.delete(schema.party).where(sql`${schema.party.endedAt} < ${new Date(Date.now() - 7 * 86_400_000)}`);
  return ended.length;
}
