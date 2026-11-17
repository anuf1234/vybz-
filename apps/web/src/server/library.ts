import {
  type LibraryResponse,
  PLAYLIST_MAX_TRACKS,
  type PlaylistListResponse,
  type PlaylistSummary,
  type PlaylistTrackView,
  type PlaylistView,
  type SavedTrack,
  GENRE_KEYS,
} from "@vybz/core";
import { type Executor, and, asc, desc, eq, inArray, or, schema, sql } from "@vybz/db";
import { type TrackProviderRef, type ViewerContext, resolvePlayback } from "@vybz/providers";
import { z } from "zod";
import { newInviteCode, secretMatches } from "./battles/access";
import { type BattleDeps, ServiceError, type UserRow, usersById } from "./battles/service";
import { CatalogError, type CatalogDeps, ensureTrack, refsForTracks, suggestionsFor, toTrackView } from "./catalog";

/**
 * Saved songs and playlists. Songs are canonical tracks (the same rows battles
 * use), so anything saved can be picked in a battle. Adding a song stores its
 * metadata only; the YouTube match is made later, when it's picked, to spare
 * the YouTube quota.
 */

const PREFERRED: TrackProviderRef["provider"][] = ["APPLE_MUSIC", "YOUTUBE", "VYBZ_DEMO"];

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  return user;
}

/** Stored tracks as list rows: metadata, the id to pick them by, and how this viewer can hear them. */
export async function savedTracks(db: Executor, catalog: CatalogDeps, trackIds: string[], viewer: ViewerContext): Promise<Map<string, SavedTrack>> {
  if (!trackIds.length) return new Map();
  const [rows, refs] = await Promise.all([db.select().from(schema.track).where(inArray(schema.track.id, trackIds)), refsForTracks(db, trackIds)]);
  const out = new Map<string, SavedTrack>();
  for (const t of rows) {
    const r = refs.get(t.id) ?? [];
    const primary = PREFERRED.map((p) => r.find((x) => x.provider === p)).find(Boolean);
    if (!primary) continue;
    const v = toTrackView(t);
    out.set(t.id, {
      trackId: t.id,
      catalogId: `${primary.provider}:${primary.externalId}`,
      title: v.title,
      artistName: v.artistName,
      ...(v.albumName ? { albumName: v.albumName } : {}),
      ...(v.releaseYear ? { releaseYear: v.releaseYear } : {}),
      ...(v.durationMs ? { durationMs: v.durationMs } : {}),
      ...(v.artworkUrl ? { artworkUrl: v.artworkUrl } : {}),
      explicit: v.explicit,
      sources: resolvePlayback(r, viewer, catalog.playback),
    });
  }
  return out;
}

const SongRef = z.union([z.object({ catalogId: z.string().min(3).max(80) }).strict(), z.object({ trackId: z.string().min(1).max(40) }).strict()]);

/** The track id for a catalog id (storing it if new, without a YouTube search) or an existing track id. */
async function resolveSong(deps: BattleDeps, body: unknown): Promise<string> {
  const parsed = SongRef.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", "Send a catalogId or a trackId.");
  if ("trackId" in parsed.data) {
    const [t] = await deps.db.select({ id: schema.track.id }).from(schema.track).where(eq(schema.track.id, parsed.data.trackId));
    if (!t) throw new ServiceError(404, "TRACK_NOT_FOUND");
    return t.id;
  }
  try {
    return (await ensureTrack(deps.db, { ...deps.catalog, youtube: null }, parsed.data.catalogId)).track.id;
  } catch (err) {
    if (err instanceof CatalogError) throw new ServiceError(err.code === "TRACK_NOT_FOUND" ? 404 : err.code === "PROVIDER_UNAVAILABLE" ? 503 : 400, err.code);
    throw err;
  }
}

// ── Saved songs ────────────────────────────────────────────────────────────

export async function listLibrary(deps: BattleDeps, user: UserRow | null, viewer: ViewerContext): Promise<LibraryResponse> {
  const me = requireUser(user);
  const rows = await deps.db.select().from(schema.libraryTrack).where(eq(schema.libraryTrack.userId, me.id)).orderBy(desc(schema.libraryTrack.createdAt)).limit(500);
  const hits = await savedTracks(deps.db, deps.catalog, rows.map((r) => r.trackId), viewer);
  return {
    items: rows.flatMap((r) => {
      const h = hits.get(r.trackId);
      return h ? [{ ...h, savedAt: r.createdAt.toISOString() }] : [];
    }),
    trackIds: rows.map((r) => r.trackId),
  };
}

export async function saveToLibrary(deps: BattleDeps, user: UserRow | null, body: unknown): Promise<{ trackId: string }> {
  const me = requireUser(user);
  const trackId = await resolveSong(deps, body);
  await deps.db.insert(schema.libraryTrack).values({ userId: me.id, trackId }).onConflictDoNothing();
  return { trackId };
}

export async function removeFromLibrary(deps: BattleDeps, user: UserRow | null, trackId: string): Promise<void> {
  const me = requireUser(user);
  await deps.db.delete(schema.libraryTrack).where(and(eq(schema.libraryTrack.userId, me.id), eq(schema.libraryTrack.trackId, trackId)));
}

// ── Playlists ──────────────────────────────────────────────────────────────

type PlaylistRow = typeof schema.playlist.$inferSelect;

const Title = z.string().trim().min(1).max(80);
const Description = z.string().trim().max(500);
const Year = z.number().int().min(1900).max(2100);

const CreateSchema = z
  .object({
    title: Title,
    description: Description.optional(),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
    generate: z
      .object({ genres: z.array(z.enum(GENRE_KEYS)).max(3), eraFrom: Year.optional(), eraTo: Year.optional(), size: z.number().int().min(5).max(50).optional() })
      .strict()
      .refine((g) => g.eraFrom === undefined || g.eraTo === undefined || g.eraFrom <= g.eraTo, { message: "eraFrom must not be after eraTo" })
      .optional(),
  })
  .strict();

const UpdateSchema = z.object({ title: Title.optional(), description: Description.nullable().optional(), visibility: z.enum(["PUBLIC", "PRIVATE"]).optional() }).strict();

async function loadPlaylist(db: Executor, id: string): Promise<PlaylistRow | null> {
  const [row] = await db.select().from(schema.playlist).where(eq(schema.playlist.id, id));
  return row ?? null;
}

async function isCollaborator(db: Executor, playlistId: string, userId: string): Promise<boolean> {
  const [c] = await db
    .select({ id: schema.playlistCollaborator.userId })
    .from(schema.playlistCollaborator)
    .where(and(eq(schema.playlistCollaborator.playlistId, playlistId), eq(schema.playlistCollaborator.userId, userId)));
  return Boolean(c);
}

/** Owner and collaborators can change the songs. */
async function requireEditor(db: Executor, id: string, user: UserRow | null): Promise<{ row: PlaylistRow; me: UserRow }> {
  const me = requireUser(user);
  const row = await loadPlaylist(db, id);
  if (!row) throw new ServiceError(404, "NOT_FOUND");
  if (row.ownerId !== me.id && !(await isCollaborator(db, id, me.id))) {
    // Don't reveal private playlists to strangers.
    throw new ServiceError(row.visibility === "PUBLIC" ? 403 : 404, row.visibility === "PUBLIC" ? "FORBIDDEN" : "NOT_FOUND");
  }
  return { row, me };
}

async function requireOwner(db: Executor, id: string, user: UserRow | null): Promise<{ row: PlaylistRow; me: UserRow }> {
  const { row, me } = await requireEditor(db, id, user);
  if (row.ownerId !== me.id) throw new ServiceError(403, "NOT_OWNER", "Only the playlist's owner can do that.");
  return { row, me };
}

export async function summaries(db: Executor, rows: PlaylistRow[]): Promise<PlaylistSummary[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [owners, counts, covers] = await Promise.all([
    usersById(db, [...new Set(rows.map((r) => r.ownerId))]),
    db
      .select({ id: schema.playlistTrack.playlistId, n: sql<number>`count(*)::int` })
      .from(schema.playlistTrack)
      .where(inArray(schema.playlistTrack.playlistId, ids))
      .groupBy(schema.playlistTrack.playlistId),
    db
      .select({ id: schema.playlistTrack.playlistId, art: schema.track.artworkUrl, position: schema.playlistTrack.position })
      .from(schema.playlistTrack)
      .innerJoin(schema.track, eq(schema.track.id, schema.playlistTrack.trackId))
      .where(inArray(schema.playlistTrack.playlistId, ids))
      .orderBy(asc(schema.playlistTrack.position)),
  ]);
  const count = new Map(counts.map((c) => [c.id, c.n]));
  const art = new Map<string, string[]>();
  for (const c of covers) {
    if (!c.art) continue;
    const list = art.get(c.id) ?? [];
    if (list.length < 4 && !list.includes(c.art)) list.push(c.art);
    art.set(c.id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    owner: owners.get(r.ownerId) ?? { id: r.ownerId, handle: "unknown", displayName: "Unknown", image: null },
    visibility: r.visibility,
    trackCount: count.get(r.id) ?? 0,
    artworkUrls: art.get(r.id) ?? [],
    genres: r.genres,
    eraFrom: r.eraFrom,
    eraTo: r.eraTo,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** mine: playlists you own or collaborate on. public: everyone's public playlists. user: someone's public ones. */
export async function listPlaylists(deps: BattleDeps, user: UserRow | null, scope: { kind: "mine" } | { kind: "public" } | { kind: "user"; userId: string }): Promise<PlaylistListResponse> {
  const p = schema.playlist;
  let where;
  if (scope.kind === "mine") {
    const me = requireUser(user);
    const shared = deps.db.select({ id: schema.playlistCollaborator.playlistId }).from(schema.playlistCollaborator).where(eq(schema.playlistCollaborator.userId, me.id));
    where = or(eq(p.ownerId, me.id), inArray(p.id, shared));
  } else if (scope.kind === "public") {
    where = eq(p.visibility, "PUBLIC");
  } else {
    where = and(eq(p.ownerId, scope.userId), eq(p.visibility, "PUBLIC"));
  }
  const rows = await deps.db.select().from(p).where(where).orderBy(desc(p.updatedAt)).limit(100);
  return { items: await summaries(deps.db, rows) };
}

export async function getPlaylist(deps: BattleDeps, user: UserRow | null, id: string, code: string | null, viewer: ViewerContext): Promise<PlaylistView> {
  const row = await loadPlaylist(deps.db, id);
  if (!row) throw new ServiceError(404, "NOT_FOUND");
  const isOwner = user?.id === row.ownerId;
  const canEdit = isOwner || (user ? await isCollaborator(deps.db, id, user.id) : false);
  if (row.visibility === "PRIVATE" && !canEdit && !(code && secretMatches(row.shareCode, code))) throw new ServiceError(404, "NOT_FOUND");

  const entries = await deps.db.select().from(schema.playlistTrack).where(eq(schema.playlistTrack.playlistId, id)).orderBy(asc(schema.playlistTrack.position));
  const collabRows = await deps.db.select().from(schema.playlistCollaborator).where(eq(schema.playlistCollaborator.playlistId, id));
  const [hits, people, [summary]] = await Promise.all([
    savedTracks(deps.db, deps.catalog, entries.map((e) => e.trackId), viewer),
    usersById(deps.db, [...new Set([...entries.map((e) => e.addedById).filter((x): x is string => Boolean(x)), ...collabRows.map((c) => c.userId)])]),
    summaries(deps.db, [row]),
  ]);
  const tracks: PlaylistTrackView[] = entries.flatMap((e, i) => {
    const h = hits.get(e.trackId);
    return h ? [{ ...h, position: i, addedBy: e.addedById ? (people.get(e.addedById) ?? null) : null }] : [];
  });
  return {
    ...summary!,
    tracks,
    collaborators: collabRows.map((c) => people.get(c.userId)).filter((u): u is NonNullable<typeof u> => Boolean(u)),
    shareCode: canEdit ? row.shareCode : null,
    viewer: { isOwner, canEdit },
  };
}

export async function createPlaylist(deps: BattleDeps, user: UserRow | null, body: unknown, viewer: ViewerContext): Promise<{ id: string }> {
  const me = requireUser(user);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  const { title, description, visibility, generate } = parsed.data;
  const [{ n }] = (await deps.db.select({ n: sql<number>`count(*)::int` }).from(schema.playlist).where(eq(schema.playlist.ownerId, me.id))) as [{ n: number }];
  if (n >= 200) throw new ServiceError(409, "TOO_MANY_PLAYLISTS", "You have the maximum number of playlists. Delete one first.");

  const id = newInviteCode() + newInviteCode().slice(0, 4);
  await deps.db.insert(schema.playlist).values({
    id,
    ownerId: me.id,
    title,
    description: description || null,
    visibility: visibility ?? "PRIVATE",
    shareCode: newInviteCode(),
    genres: generate?.genres ?? [],
    eraFrom: generate?.eraFrom ?? null,
    eraTo: generate?.eraTo ?? null,
  });

  if (generate) {
    const theme = { genres: generate.genres, ...(generate.eraFrom !== undefined ? { eraFrom: generate.eraFrom } : {}), ...(generate.eraTo !== undefined ? { eraTo: generate.eraTo } : {}) };
    const { items } = await suggestionsFor(deps.catalog, theme, viewer);
    const picks = items.slice(0, generate.size ?? 25);
    let position = 0;
    for (const hit of picks) {
      try {
        const t = await ensureTrack(deps.db, { ...deps.catalog, youtube: null }, hit.catalogId);
        await deps.db.insert(schema.playlistTrack).values({ playlistId: id, trackId: t.track.id, position: position++, addedById: me.id }).onConflictDoNothing();
      } catch (err) {
        console.warn("generated playlist: skipped a track", err);
      }
    }
  }
  return { id };
}

export async function updatePlaylist(deps: BattleDeps, user: UserRow | null, id: string, body: unknown): Promise<void> {
  await requireOwner(deps.db, id, user);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  const { title, description, visibility } = parsed.data;
  if (title === undefined && description === undefined && visibility === undefined) return;
  await deps.db
    .update(schema.playlist)
    .set({ ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description: description || null } : {}), ...(visibility ? { visibility } : {}) })
    .where(eq(schema.playlist.id, id));
}

export async function deletePlaylist(deps: BattleDeps, user: UserRow | null, id: string): Promise<void> {
  await requireOwner(deps.db, id, user);
  await deps.db.delete(schema.playlist).where(eq(schema.playlist.id, id));
}

async function touch(db: Executor, id: string) {
  await db.update(schema.playlist).set({ updatedAt: new Date() }).where(eq(schema.playlist.id, id));
}

export async function addToPlaylist(deps: BattleDeps, user: UserRow | null, id: string, body: unknown): Promise<{ trackId: string }> {
  const { me } = await requireEditor(deps.db, id, user);
  const trackId = await resolveSong(deps, body);
  const pt = schema.playlistTrack;
  const [{ n, max }] = (await deps.db
    .select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${pt.position}), -1)::int` })
    .from(pt)
    .where(eq(pt.playlistId, id))) as [{ n: number; max: number }];
  if (n >= PLAYLIST_MAX_TRACKS) throw new ServiceError(409, "PLAYLIST_FULL", `Playlists hold up to ${PLAYLIST_MAX_TRACKS} songs.`);
  const inserted = await deps.db.insert(pt).values({ playlistId: id, trackId, position: max + 1, addedById: me.id }).onConflictDoNothing().returning();
  if (!inserted.length) throw new ServiceError(409, "ALREADY_IN_PLAYLIST", "That song is already in this playlist.");
  await touch(deps.db, id);
  return { trackId };
}

export async function removeFromPlaylist(deps: BattleDeps, user: UserRow | null, id: string, trackId: string): Promise<void> {
  await requireEditor(deps.db, id, user);
  await deps.db.delete(schema.playlistTrack).where(and(eq(schema.playlistTrack.playlistId, id), eq(schema.playlistTrack.trackId, trackId)));
  await touch(deps.db, id);
}

const OrderSchema = z.object({ trackIds: z.array(z.string().min(1).max(40)).max(PLAYLIST_MAX_TRACKS) }).strict();

/** Sets the full order. The list must hold exactly the playlist's songs. */
export async function reorderPlaylist(deps: BattleDeps, user: UserRow | null, id: string, body: unknown): Promise<void> {
  await requireEditor(deps.db, id, user);
  const parsed = OrderSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  const { trackIds } = parsed.data;
  await deps.db.transaction(async (tx) => {
    const current = await tx.select({ trackId: schema.playlistTrack.trackId }).from(schema.playlistTrack).where(eq(schema.playlistTrack.playlistId, id));
    const have = new Set(current.map((c) => c.trackId));
    if (have.size !== trackIds.length || new Set(trackIds).size !== trackIds.length || trackIds.some((t) => !have.has(t))) {
      throw new ServiceError(409, "ORDER_MISMATCH", "The playlist changed. Refresh and try again.");
    }
    for (const [i, trackId] of trackIds.entries()) {
      await tx.update(schema.playlistTrack).set({ position: i }).where(and(eq(schema.playlistTrack.playlistId, id), eq(schema.playlistTrack.trackId, trackId)));
    }
    await tx.update(schema.playlist).set({ updatedAt: new Date() }).where(eq(schema.playlist.id, id));
  });
}

const CollaboratorSchema = z.object({ handle: z.string().trim().min(1).max(40) }).strict();

export async function addCollaborator(deps: BattleDeps, user: UserRow | null, id: string, body: unknown): Promise<void> {
  const { row } = await requireOwner(deps.db, id, user);
  const parsed = CollaboratorSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST");
  const handle = parsed.data.handle.replace(/^@/, "").toLowerCase();
  const [u] = await deps.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.handle, handle));
  if (!u) throw new ServiceError(404, "OPPONENT_NOT_FOUND", "No one has that handle.");
  if (u.id === row.ownerId) throw new ServiceError(400, "INVALID_REQUEST", "You already own this playlist.");
  const [{ n }] = (await deps.db.select({ n: sql<number>`count(*)::int` }).from(schema.playlistCollaborator).where(eq(schema.playlistCollaborator.playlistId, id))) as [{ n: number }];
  if (n >= 20) throw new ServiceError(409, "TOO_MANY_COLLABORATORS", "A playlist can have up to 20 collaborators.");
  await deps.db.insert(schema.playlistCollaborator).values({ playlistId: id, userId: u.id }).onConflictDoNothing();
}

/** The owner removes someone, or a collaborator leaves. */
export async function removeCollaborator(deps: BattleDeps, user: UserRow | null, id: string, userId: string): Promise<void> {
  const me = requireUser(user);
  const row = await loadPlaylist(deps.db, id);
  if (!row) throw new ServiceError(404, "NOT_FOUND");
  if (row.ownerId !== me.id && me.id !== userId) throw new ServiceError(403, "NOT_OWNER", "Only the playlist's owner can do that.");
  await deps.db.delete(schema.playlistCollaborator).where(and(eq(schema.playlistCollaborator.playlistId, id), eq(schema.playlistCollaborator.userId, userId)));
}
