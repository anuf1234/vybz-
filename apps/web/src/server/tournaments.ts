import { TOURNAMENT, type TournamentEntry, type TournamentListItem, type TournamentMatch, type TournamentView, bracketOrder, roundName } from "@vybz/core";
import { type Executor, and, desc, eq, gte, inArray, lte, newId, or, schema, sql } from "@vybz/db";
import { isStaff } from "./battles/access";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { botUser } from "./bot";
import { CatalogError, ensureTrack } from "./catalog";
import { createNotifications } from "./notifications";
import { grant, systemIds } from "./progression";
import { recordActivity } from "./vybz-streak";

/**
 * Song tournaments: 8 or 16 songs, seeded, voted through round by round
 * (about 42 hours a round, so 16 songs take about a week). Each matchup's
 * votes stay hidden until you've voted in it. Ties go to the higher seed.
 * Staff create them; everyone votes.
 */

type Row = typeof schema.tournament.$inferSelect;
interface Result {
  a: number;
  b: number;
  votesA: number;
  votesB: number;
  winner: number;
}

const ROUND_MS = TOURNAMENT.roundHours * 3600_000;

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  return user;
}

/** `{ title, description?, catalogIds: [seed 1, seed 2, …] }` with 8 or 16 songs. Staff only. */
export async function createTournament(deps: BattleDeps, viewer: UserRow | null, body: unknown, now = new Date()): Promise<TournamentView> {
  const user = requireUser(viewer);
  if (!isStaff(user)) throw new ServiceError(403, "FORBIDDEN");
  const b = (body ?? {}) as { title?: unknown; description?: unknown; catalogIds?: unknown };
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (title.length < 3 || title.length > 80) throw new ServiceError(400, "INVALID_TITLE", "Give it a title (3–80 characters).");
  const ids = Array.isArray(b.catalogIds) ? b.catalogIds.filter((x): x is string => typeof x === "string") : [];
  if (!(TOURNAMENT.sizes as readonly number[]).includes(ids.length) || new Set(ids).size !== ids.length) throw new ServiceError(400, "INVALID_SIZE", "Pick 8 or 16 different songs.");
  const entries: TournamentEntry[] = [];
  for (const id of ids) {
    try {
      const st = await ensureTrack(deps.db, deps.catalog, id);
      entries.push({
        catalogId: id,
        trackId: st.track.id,
        title: st.track.title,
        artistName: st.track.artistName,
        artworkUrl: st.track.artworkUrl,
        previewUrl: st.refs.find((r) => r.previewUrl)?.previewUrl ?? null,
        externalUrl: st.refs.find((r) => r.externalUrl)?.externalUrl ?? null,
      });
    } catch (err) {
      if (err instanceof CatalogError) throw new ServiceError(404, "SONG_NOT_FOUND", "One of those songs couldn't be found.");
      throw err;
    }
  }
  if (new Set(entries.map((e) => e.trackId)).size !== entries.length) throw new ServiceError(400, "INVALID_SIZE", "Pick 8 or 16 different songs.");
  const [row] = await deps.db
    .insert(schema.tournament)
    .values({
      id: newId(),
      title,
      description: typeof b.description === "string" ? b.description.trim().slice(0, 300) || null : null,
      creatorId: user.id,
      entries,
      alive: bracketOrder(entries.length),
      roundEndsAt: new Date(now.getTime() + ROUND_MS),
      createdAt: now,
    })
    .returning();
  return view(deps.db, user, row!);
}

async function tallies(db: Executor, id: string, round: number) {
  return db
    .select({ match: schema.tournamentVote.match, entry: schema.tournamentVote.entry, n: sql<number>`count(*)::int` })
    .from(schema.tournamentVote)
    .where(and(eq(schema.tournamentVote.tournamentId, id), eq(schema.tournamentVote.round, round)))
    .groupBy(schema.tournamentVote.match, schema.tournamentVote.entry);
}

async function view(db: Executor, viewer: UserRow | null, t: Row): Promise<TournamentView> {
  const entries = t.entries as TournamentEntry[];
  const results = t.results as Result[][];
  const alive = t.alive as number[];
  const live = t.status === "LIVE";
  const [t_, mine, voters, creator] = await Promise.all([
    live ? tallies(db, t.id, t.round) : Promise.resolve([]),
    viewer && live
      ? db
          .select({ match: schema.tournamentVote.match, entry: schema.tournamentVote.entry })
          .from(schema.tournamentVote)
          .where(and(eq(schema.tournamentVote.tournamentId, t.id), eq(schema.tournamentVote.userId, viewer.id), eq(schema.tournamentVote.round, t.round)))
      : Promise.resolve([]),
    db
      .select({ n: sql<number>`count(distinct ${schema.tournamentVote.userId})::int` })
      .from(schema.tournamentVote)
      .where(eq(schema.tournamentVote.tournamentId, t.id))
      .then((x) => x[0]?.n ?? 0),
    db.select({ handle: schema.user.handle }).from(schema.user).where(eq(schema.user.id, t.creatorId)).then((x) => x[0]),
  ]);
  const rounds: TournamentView["rounds"] = results.map((r, i) => ({
    name: roundName(entries.length, i),
    done: true,
    matches: r.map((m, j) => ({ index: j, a: m.a, b: m.b, votesA: m.votesA, votesB: m.votesB, winner: m.winner, mine: null })),
  }));
  if (live) {
    const matches: TournamentMatch[] = [];
    for (let j = 0; j * 2 + 1 < alive.length; j++) {
      const a = alive[j * 2]!;
      const b = alive[j * 2 + 1]!;
      const my = mine.find((m) => m.match === j)?.entry ?? null;
      const n = (e: number) => t_.find((x) => x.match === j && x.entry === e)?.n ?? 0;
      matches.push({ index: j, a, b, votesA: my !== null ? n(a) : null, votesB: my !== null ? n(b) : null, winner: null, mine: my });
    }
    rounds.push({ name: roundName(entries.length, t.round), done: false, matches });
  }
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status as TournamentView["status"],
    entries,
    rounds,
    round: t.round,
    roundEndsAt: t.roundEndsAt.toISOString(),
    champion: t.champion,
    voters,
    creator: { handle: creator?.handle ?? "vybz" },
  };
}

export async function getTournament(deps: BattleDeps, viewer: UserRow | null, id: string): Promise<TournamentView> {
  await advanceTournaments(deps);
  const [t] = await deps.db.select().from(schema.tournament).where(eq(schema.tournament.id, id));
  if (!t) throw new ServiceError(404, "NOT_FOUND");
  return view(deps.db, viewer, t);
}

export async function listTournaments(deps: BattleDeps): Promise<{ items: TournamentListItem[] }> {
  await advanceTournaments(deps);
  const rows = await deps.db
    .select()
    .from(schema.tournament)
    .where(or(eq(schema.tournament.status, "LIVE"), gte(schema.tournament.updatedAt, new Date(Date.now() - 30 * 86_400_000))))
    .orderBy(desc(schema.tournament.status), desc(schema.tournament.createdAt))
    .limit(30);
  const ids = rows.map((r) => r.id);
  const voters = ids.length
    ? await deps.db
        .select({ id: schema.tournamentVote.tournamentId, n: sql<number>`count(distinct ${schema.tournamentVote.userId})::int` })
        .from(schema.tournamentVote)
        .where(inArray(schema.tournamentVote.tournamentId, ids))
        .groupBy(schema.tournamentVote.tournamentId)
    : [];
  return {
    items: rows.map((r) => {
      const e = r.entries as TournamentEntry[];
      const champ = r.champion !== null ? e[r.champion] : undefined;
      return {
        id: r.id,
        title: r.title,
        status: r.status as TournamentListItem["status"],
        size: e.length,
        roundName: r.status === "DONE" ? "Finished" : roundName(e.length, r.round),
        roundEndsAt: r.roundEndsAt.toISOString(),
        champion: champ ? { title: champ.title, artistName: champ.artistName, artworkUrl: champ.artworkUrl } : null,
        voters: voters.find((v) => v.id === r.id)?.n ?? 0,
        artwork: e.slice(0, 4).map((x) => x.artworkUrl),
      };
    }),
  };
}

/** `{ match, entry }` in the current round; can be changed until the round ends. */
export async function voteTournament(deps: BattleDeps, viewer: UserRow | null, id: string, body: unknown, now = new Date()): Promise<TournamentView> {
  const user = requireUser(viewer);
  await advanceTournaments(deps, now);
  const [t] = await deps.db.select().from(schema.tournament).where(eq(schema.tournament.id, id));
  if (!t) throw new ServiceError(404, "NOT_FOUND");
  if (t.status !== "LIVE") throw new ServiceError(409, "TOURNAMENT_OVER", "This tournament is over.");
  const b = (body ?? {}) as { match?: unknown; entry?: unknown };
  const alive = t.alive as number[];
  const match = typeof b.match === "number" ? b.match : -1;
  const pair = [alive[match * 2], alive[match * 2 + 1]];
  if (!Number.isInteger(match) || pair[0] === undefined || pair[1] === undefined || !pair.includes(b.entry as number)) throw new ServiceError(400, "INVALID_VOTE");
  const [before] = await deps.db
    .select()
    .from(schema.tournamentVote)
    .where(and(eq(schema.tournamentVote.tournamentId, id), eq(schema.tournamentVote.userId, user.id), eq(schema.tournamentVote.round, t.round), eq(schema.tournamentVote.match, match)));
  await deps.db
    .insert(schema.tournamentVote)
    .values({ tournamentId: id, userId: user.id, round: t.round, match, entry: b.entry as number, createdAt: now })
    .onConflictDoUpdate({ target: [schema.tournamentVote.tournamentId, schema.tournamentVote.userId, schema.tournamentVote.round, schema.tournamentVote.match], set: { entry: b.entry as number } });
  if (!before && !(await systemIds(deps.db, [user.id])).size) {
    const l = schema.ledgerEntry;
    const [{ n }] = (await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(l)
      .where(and(eq(l.userId, user.id), eq(l.reason, "TOURNAMENT_VOTE"), gte(l.createdAt, new Date(now.getTime() - 86_400_000))))) as [{ n: number }];
    if (n < TOURNAMENT.voteXpPerDay) await grant(deps.db, user.id, "TOURNAMENT_VOTE", `${id}:${t.round}:${match}`, { xp: TOURNAMENT.voteXp, coins: 0 });
    await recordActivity(deps.db, user.id, now);
  }
  return view(deps.db, user, t);
}

/** Closes rounds whose time is up: winners advance (ties to the higher seed); the last one crowns a champion and posts it. */
export async function advanceTournaments(deps: Pick<BattleDeps, "db" | "push"> & Partial<BattleDeps>, now = new Date()): Promise<number> {
  const due = await deps.db
    .select()
    .from(schema.tournament)
    .where(and(eq(schema.tournament.status, "LIVE"), lte(schema.tournament.roundEndsAt, now)));
  let n = 0;
  for (const t of due) {
    const alive = t.alive as number[];
    const counts = await tallies(deps.db, t.id, t.round);
    const results: Result[] = [];
    for (let j = 0; j * 2 + 1 < alive.length; j++) {
      const a = alive[j * 2]!;
      const b = alive[j * 2 + 1]!;
      const va = counts.find((x) => x.match === j && x.entry === a)?.n ?? 0;
      const vb = counts.find((x) => x.match === j && x.entry === b)?.n ?? 0;
      // Lower index = higher seed wins ties.
      results.push({ a, b, votesA: va, votesB: vb, winner: va > vb ? a : vb > va ? b : Math.min(a, b) });
    }
    const next = results.map((r) => r.winner);
    const done = next.length === 1;
    const [moved] = await deps.db
      .update(schema.tournament)
      .set({
        results: [...(t.results as Result[][]), results],
        alive: next,
        round: done ? t.round : t.round + 1,
        status: done ? "DONE" : "LIVE",
        champion: done ? next[0]! : null,
        roundEndsAt: done ? now : new Date(now.getTime() + ROUND_MS),
      })
      .where(and(eq(schema.tournament.id, t.id), eq(schema.tournament.round, t.round), eq(schema.tournament.status, "LIVE")))
      .returning();
    if (!moved) continue;
    n++;
    const entries = t.entries as TournamentEntry[];
    const voters = await deps.db.selectDistinct({ userId: schema.tournamentVote.userId }).from(schema.tournamentVote).where(eq(schema.tournamentVote.tournamentId, t.id));
    if (done) {
      const champ = entries[next[0]!]!;
      await createNotifications(
        deps.db,
        deps.push,
        voters.map((v) => ({ userId: v.userId, type: "TOURNAMENT" as const, title: `🏆 ${champ.title} wins "${t.title}"`, body: `${champ.artistName} takes the crown.`, battleId: null, link: `/tournaments/${t.id}` })),
      );
      if (deps.catalog) {
        try {
          const bot = await botUser(deps as BattleDeps);
          await deps.db.insert(schema.post).values({ id: newId(), authorId: bot.id, body: `🏆 "${t.title}" is decided: ${champ.title} by ${champ.artistName} wins the bracket. Thanks to everyone who voted.` });
        } catch (err) {
          console.error("tournament post failed", err);
        }
      }
    } else {
      await createNotifications(
        deps.db,
        deps.push,
        voters.map((v) => ({ userId: v.userId, type: "TOURNAMENT" as const, title: `${roundName(entries.length, t.round + 1)}: "${t.title}"`, body: "The next round is open. Vote now.", battleId: null, link: `/tournaments/${t.id}` })),
      );
    }
  }
  return n;
}
