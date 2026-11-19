import {
  type AlbumHit,
  WARS,
  WAR_CATEGORIES,
  type WarKind,
  type WarListItem,
  type WarPeriod,
  type WarRankingRow,
  type WarRankingsResponse,
  type WarSide,
  type WarView,
  isTrackCategory,
  trackCategory,
} from "@vybz/core";
import { type Executor, and, desc, eq, gte, inArray, lte, newId, schema, sql } from "@vybz/db";
import { type AlbumCandidate, type AlbumProvider, isAlbumProvider } from "@vybz/providers";
import { type BattleDeps, ServiceError, type UserRow, usersById } from "./battles/service";
import { CatalogError, ensureTrack, parseCatalogId } from "./catalog";
import { createNotifications } from "./notifications";
import { grant, systemIds } from "./progression";
import { recordActivity } from "./vybz-streak";

/**
 * Album and Single Wars. Sides are snapshots of the provider's album (with
 * its track list) or song; artwork and previews stay on the provider. Votes
 * are per category and can be changed until the war closes; counts stay
 * hidden for a category until you've voted in it, so early votes don't sway
 * later ones.
 */

type WarRow = typeof schema.war.$inferSelect;

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  return user;
}

function albumProvider(deps: BattleDeps): AlbumProvider | null {
  const all = deps.catalog.metadata.filter(isAlbumProvider) as unknown as AlbumProvider[];
  return all.find((p) => p.kind === "APPLE_MUSIC") ?? all[0] ?? null;
}

const toHit = (a: AlbumCandidate): AlbumHit => ({
  ref: `${a.provider}:${a.externalId}`,
  title: a.title,
  artistName: a.artistName,
  releaseYear: a.releaseYear ?? null,
  artworkUrl: a.artwork?.url ?? null,
  trackCount: a.trackCount ?? null,
  isSingle: !!a.isSingle,
});

export async function searchAlbums(deps: BattleDeps, q: string): Promise<AlbumHit[]> {
  const p = albumProvider(deps);
  if (!p) throw new ServiceError(503, "ALBUMS_UNAVAILABLE", "Album search isn't available right now.");
  const term = q.trim().slice(0, 100);
  if (!term) return [];
  return (await p.searchAlbums(term, { storefront: deps.catalog.storefront, limit: 15 })).map(toHit);
}

const topCache = new Map<string, { at: number; items: AlbumHit[] }>();

/** What's charting now, to start a war from. Cached for an hour. */
export async function trendingAlbums(deps: BattleDeps): Promise<AlbumHit[]> {
  const p = albumProvider(deps);
  if (!p) return [];
  const key = `${p.kind}:${deps.catalog.storefront}`;
  const hit = topCache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.items;
  try {
    const items = (await p.topAlbums({ storefront: deps.catalog.storefront, limit: 24 })).filter((a) => !a.isSingle).map(toHit);
    topCache.set(key, { at: Date.now(), items });
    return items;
  } catch (err) {
    console.error("top albums failed", err);
    return hit?.items ?? [];
  }
}

async function resolveSide(db: Executor, deps: BattleDeps, kind: WarKind, ref: unknown): Promise<WarSide> {
  if (typeof ref !== "string") throw new ServiceError(400, "INVALID_SIDE", "Pick two releases.");
  if (kind === "ALBUM") {
    const parsed = parseCatalogId(ref);
    const p = albumProvider(deps);
    if (!parsed || !p || parsed.provider !== p.kind) throw new ServiceError(400, "INVALID_SIDE", "Pick albums from the search.");
    const al = await p.getAlbum(parsed.externalId, { storefront: deps.catalog.storefront });
    if (!al) throw new ServiceError(404, "ALBUM_NOT_FOUND", "Couldn't find that album.");
    if (al.isSingle) throw new ServiceError(400, "IS_SINGLE", `"${al.title}" is a single. Start a Single War for songs.`);
    return {
      ref,
      title: al.title,
      artistName: al.artistName,
      releaseYear: al.releaseYear ?? null,
      artworkUrl: al.artwork?.url ?? null,
      externalUrl: al.externalUrl ?? null,
      tracks: (al.tracks ?? []).slice(0, 40).map((t) => ({ title: t.title, catalogId: `${t.provider}:${t.externalId}`, durationMs: t.durationMs ?? null, previewUrl: t.previewUrl ?? null })),
    };
  }
  try {
    const st = await ensureTrack(db, deps.catalog, ref);
    const preview = st.refs.find((r) => r.previewUrl)?.previewUrl ?? null;
    const url = st.refs.find((r) => r.externalUrl)?.externalUrl ?? null;
    return {
      ref,
      title: st.track.title,
      artistName: st.track.artistName,
      releaseYear: st.track.releaseYear,
      artworkUrl: st.track.artworkUrl,
      externalUrl: url,
      tracks: [{ title: st.track.title, catalogId: ref, durationMs: st.track.durationMs, previewUrl: preview }],
    };
  } catch (err) {
    if (err instanceof CatalogError) throw new ServiceError(404, "SONG_NOT_FOUND", "Couldn't find that song.");
    throw err;
  }
}

export async function createWar(deps: BattleDeps, viewer: UserRow | null, body: unknown, opts: { challenge?: WarView["challenge"] } = {}): Promise<WarView> {
  const user = requireUser(viewer);
  const b = (body ?? {}) as { kind?: unknown; a?: unknown; b?: unknown };
  if (b.kind !== undefined && b.kind !== "ALBUM" && b.kind !== "SINGLE") throw new ServiceError(400, "INVALID_KIND");
  const kind: WarKind = b.kind === "SINGLE" ? "SINGLE" : "ALBUM";
  if (typeof b.a !== "string" || typeof b.b !== "string" || b.a === b.b) throw new ServiceError(400, "INVALID_SIDE", "Pick two different releases.");
  const pairKey = `${kind}:${[b.a, b.b].sort().join("|")}`;
  const [existing] = await deps.db.select().from(schema.war).where(and(eq(schema.war.pairKey, pairKey), eq(schema.war.status, "OPEN")));
  if (existing) return warView(deps, user, existing);
  const [{ n }] = (await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.war)
    .where(and(eq(schema.war.creatorId, user.id), gte(schema.war.createdAt, new Date(Date.now() - 86_400_000))))) as [{ n: number }];
  if (n >= 10) throw new ServiceError(429, "SLOW_DOWN", "You've started 10 wars today. Vote in some others!");
  const [a, bb] = await Promise.all([resolveSide(deps.db, deps, kind, b.a), resolveSide(deps.db, deps, kind, b.b)]);
  const [row] = await deps.db
    .insert(schema.war)
    .values({
      id: newId(),
      kind,
      title: `${a.title} vs ${bb.title}`.slice(0, 160),
      pairKey,
      a,
      b: bb,
      aRef: a.ref,
      bRef: bb.ref,
      creatorId: user.id,
      challenge: opts.challenge ?? null,
      closesAt: new Date(Date.now() + WARS.durationDays * 86_400_000),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const [again] = await deps.db.select().from(schema.war).where(and(eq(schema.war.pairKey, pairKey), eq(schema.war.status, "OPEN")));
    return warView(deps, user, again!);
  }
  return warView(deps, user, row);
}

function trackPairs(w: WarRow): number {
  if (w.kind !== "ALBUM") return 0;
  return Math.min((w.a as WarSide).tracks.length, (w.b as WarSide).tracks.length, WARS.maxTrackBattles);
}

async function tallies(db: Executor, warIds: string[]) {
  if (!warIds.length) return [];
  return db
    .select({ warId: schema.warVote.warId, category: schema.warVote.category, side: schema.warVote.side, n: sql<number>`count(*)::int` })
    .from(schema.warVote)
    .where(inArray(schema.warVote.warId, warIds))
    .groupBy(schema.warVote.warId, schema.warVote.category, schema.warVote.side);
}

async function warView(deps: BattleDeps, viewer: UserRow | null, w: WarRow): Promise<WarView> {
  const [t, mine, voters, users] = await Promise.all([
    tallies(deps.db, [w.id]),
    viewer ? deps.db.select().from(schema.warVote).where(and(eq(schema.warVote.warId, w.id), eq(schema.warVote.voterId, viewer.id))) : Promise.resolve([]),
    deps.db.select({ n: sql<number>`count(distinct ${schema.warVote.voterId})::int` }).from(schema.warVote).where(eq(schema.warVote.warId, w.id)),
    usersById(deps.db, [w.creatorId]),
  ]);
  const count = (cat: string, side: "A" | "B") => t.find((x) => x.category === cat && x.side === side)?.n ?? 0;
  const myVote = (cat: string) => (mine.find((m) => m.category === cat)?.side as "A" | "B" | undefined) ?? null;
  const closed = w.status === "CLOSED";
  const show = (cat: string) => closed || myVote(cat) !== null;
  const a = w.a as WarSide;
  const b = w.b as WarSide;
  return {
    id: w.id,
    kind: w.kind,
    status: w.status,
    title: w.title,
    a,
    b,
    creator: users.get(w.creatorId) ?? { id: w.creatorId, handle: "unknown", displayName: "Unknown", image: null },
    closesAt: w.closesAt.toISOString(),
    voters: voters[0]?.n ?? 0,
    categories: WAR_CATEGORIES[w.kind].map((c) => ({ ...c, a: show(c.key) ? count(c.key, "A") : null, b: show(c.key) ? count(c.key, "B") : null, mine: myVote(c.key) })),
    tracks: Array.from({ length: trackPairs(w) }, (_, i) => {
      const cat = trackCategory(i);
      return { index: i, a: a.tracks[i]!, b: b.tracks[i]!, votes: show(cat) ? { a: count(cat, "A"), b: count(cat, "B") } : null, mine: myVote(cat) };
    }),
    winner: (w.winner as WarView["winner"]) ?? null,
    challenge: (w.challenge as WarView["challenge"]) ?? null,
    createdAt: w.createdAt.toISOString(),
  };
}

export async function getWar(deps: BattleDeps, viewer: UserRow | null, id: string): Promise<WarView> {
  await closeDueWars(deps);
  const [w] = await deps.db.select().from(schema.war).where(eq(schema.war.id, id));
  if (!w) throw new ServiceError(404, "NOT_FOUND");
  return warView(deps, viewer, w);
}

export async function voteWar(deps: BattleDeps, viewer: UserRow | null, id: string, body: unknown): Promise<WarView> {
  const user = requireUser(viewer);
  const b = (body ?? {}) as { category?: unknown; side?: unknown };
  await closeDueWars(deps);
  const [w] = await deps.db.select().from(schema.war).where(eq(schema.war.id, id));
  if (!w) throw new ServiceError(404, "NOT_FOUND");
  if (w.status !== "OPEN") throw new ServiceError(409, "WAR_CLOSED", "Voting has closed on this war.");
  const cat = String(b.category ?? "");
  const valid = WAR_CATEGORIES[w.kind].some((c) => c.key === cat) || (isTrackCategory(cat) && Number(cat.slice(1)) <= trackPairs(w));
  if (!valid) throw new ServiceError(400, "INVALID_CATEGORY");
  if (b.side !== "A" && b.side !== "B") throw new ServiceError(400, "INVALID_VOTE");
  const [{ before }] = (await deps.db
    .select({ before: sql<number>`count(*)::int` })
    .from(schema.warVote)
    .where(and(eq(schema.warVote.warId, id), eq(schema.warVote.voterId, user.id)))) as [{ before: number }];
  await deps.db
    .insert(schema.warVote)
    .values({ warId: id, voterId: user.id, category: cat, side: b.side })
    .onConflictDoUpdate({ target: [schema.warVote.warId, schema.warVote.voterId, schema.warVote.category], set: { side: b.side } });
  // A little XP for joining a war, a few wars a day.
  if (!before && !(await systemIds(deps.db, [user.id])).size) {
    const l = schema.ledgerEntry;
    const [{ today }] = (await deps.db
      .select({ today: sql<number>`count(*)::int` })
      .from(l)
      .where(and(eq(l.userId, user.id), eq(l.reason, "WAR_VOTE"), gte(l.createdAt, new Date(Date.now() - 86_400_000))))) as [{ today: number }];
    if (today < WARS.voteXpPerDay) await grant(deps.db, user.id, "WAR_VOTE", id, { xp: WARS.voteXp, coins: 0 });
    await recordActivity(deps.db, user.id);
  }
  return warView(deps, user, w);
}

export async function listWars(deps: BattleDeps, viewer: UserRow | null, sp: URLSearchParams): Promise<{ items: WarListItem[] }> {
  await closeDueWars(deps);
  const status = sp.get("status") === "CLOSED" ? "CLOSED" : "OPEN";
  const kind = sp.get("kind");
  const conds = [eq(schema.war.status, status)];
  if (kind === "ALBUM" || kind === "SINGLE") conds.push(eq(schema.war.kind, kind));
  const rows = await deps.db.select().from(schema.war).where(and(...conds)).orderBy(desc(status === "CLOSED" ? schema.war.closesAt : schema.war.createdAt)).limit(50);
  const ids = rows.map((r) => r.id);
  const [voters, mine] = await Promise.all([
    ids.length
      ? deps.db.select({ warId: schema.warVote.warId, n: sql<number>`count(distinct ${schema.warVote.voterId})::int` }).from(schema.warVote).where(inArray(schema.warVote.warId, ids)).groupBy(schema.warVote.warId)
      : Promise.resolve([]),
    viewer && ids.length ? deps.db.selectDistinct({ warId: schema.warVote.warId }).from(schema.warVote).where(and(inArray(schema.warVote.warId, ids), eq(schema.warVote.voterId, viewer.id))) : Promise.resolve([]),
  ]);
  const voted = new Set(mine.map((m) => m.warId));
  const pick = (s: WarSide) => ({ title: s.title, artistName: s.artistName, artworkUrl: s.artworkUrl, releaseYear: s.releaseYear });
  const items = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    title: r.title,
    a: pick(r.a as WarSide),
    b: pick(r.b as WarSide),
    voters: voters.find((v) => v.warId === r.id)?.n ?? 0,
    closesAt: r.closesAt.toISOString(),
    winner: (r.winner as WarListItem["winner"]) ?? null,
    voted: voted.has(r.id),
    challenge: (r.challenge as WarListItem["challenge"]) ?? null,
  }));
  // Live wars: busiest first.
  if (status === "OPEN") items.sort((x, y) => y.voters - x.voters || (x.closesAt < y.closesAt ? 1 : -1));
  return { items };
}

/** Closes wars whose week is up. The overall vote decides; a tie goes to whoever won more categories. */
export async function closeDueWars(deps: Pick<BattleDeps, "db" | "push">, now = new Date()): Promise<number> {
  const due = await deps.db.select().from(schema.war).where(and(eq(schema.war.status, "OPEN"), lte(schema.war.closesAt, now))).limit(100);
  let closed = 0;
  for (const w of due) {
    const t = await tallies(deps.db, [w.id]);
    const c = (cat: string, side: "A" | "B") => t.find((x) => x.category === cat && x.side === side)?.n ?? 0;
    let winner: "A" | "B" | "DRAW" = c("overall", "A") > c("overall", "B") ? "A" : c("overall", "B") > c("overall", "A") ? "B" : "DRAW";
    if (winner === "DRAW") {
      const cats = WAR_CATEGORIES[w.kind].filter((x) => x.key !== "overall");
      const aw = cats.filter((x) => c(x.key, "A") > c(x.key, "B")).length;
      const bw = cats.filter((x) => c(x.key, "B") > c(x.key, "A")).length;
      winner = aw > bw ? "A" : bw > aw ? "B" : "DRAW";
    }
    const [row] = await deps.db.update(schema.war).set({ status: "CLOSED", winner }).where(and(eq(schema.war.id, w.id), eq(schema.war.status, "OPEN"))).returning();
    if (!row) continue;
    closed++;
    const win = winner === "DRAW" ? "It's a draw" : `${(winner === "A" ? (w.a as WarSide) : (w.b as WarSide)).title} wins`;
    await createNotifications(deps.db, deps.push, [{ userId: w.creatorId, type: "WAR_RESULT", title: "💿 Your war is over", body: `${w.title}: ${win}.`, battleId: null, link: `/wars/${w.id}` }]);
  }
  return closed;
}

const PERIOD_DAYS: Record<WarPeriod, number> = { week: 7, month: 30, year: 365 };

/** Best album (or single) of the week, month or year: overall votes won in that window. */
export async function warRankings(deps: BattleDeps, sp: URLSearchParams): Promise<WarRankingsResponse> {
  const kind: WarKind = sp.get("kind") === "SINGLE" ? "SINGLE" : "ALBUM";
  const period = (["week", "month", "year"] as const).find((p) => p === sp.get("period")) ?? "week";
  const since = new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000);
  const res = await deps.db.execute<{ ref: string; side_json: WarSide; votes: number; wars: number; total: number; wins: number }>(sql`
    with v as (
      select w.id, w.a_ref, w.b_ref, w.a, w.b, w.winner, w.status, w.closes_at, wv.side
      from war_vote wv join war w on w.id = wv.war_id
      where wv.category = 'overall' and wv.created_at >= ${since} and w.kind = ${kind}
    ), per_side as (
      select a_ref as ref, a as side_json, id, count(*) filter (where side = 'A') as votes, count(*) as total,
        bool_or(status = 'CLOSED' and winner = 'A' and closes_at >= ${since}) as won from v group by a_ref, a, id
      union all
      select b_ref as ref, b as side_json, id, count(*) filter (where side = 'B') as votes, count(*) as total,
        bool_or(status = 'CLOSED' and winner = 'B' and closes_at >= ${since}) as won from v group by b_ref, b, id
    )
    select ref, (array_agg(side_json))[1] as side_json, sum(votes)::int as votes, count(distinct id)::int as wars,
      sum(total)::int as total, count(*) filter (where won)::int as wins
    from per_side group by ref
    having sum(votes) > 0
    order by sum(votes) desc, sum(votes)::float / greatest(sum(total), 1) desc
    limit 25
  `);
  const rows: WarRankingRow[] = res.rows.map((r, i) => ({
    rank: i + 1,
    ref: r.ref,
    title: r.side_json.title,
    artistName: r.side_json.artistName,
    artworkUrl: r.side_json.artworkUrl,
    releaseYear: r.side_json.releaseYear,
    votes: r.votes,
    wars: r.wars,
    wins: r.wins,
    share: r.total ? Math.round((100 * r.votes) / r.total) : 0,
  }));
  return { kind, period, rows };
}
