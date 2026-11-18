import { checkAchievements } from "./achievements";
import { parseGif, storedGif } from "./gifs";
import { awardPost } from "./progression";
import type {
  CommentView,
  ConversationView,
  FeedResponse,
  InboxResponse,
  PeopleSuggestion,
  PostAttachment,
  PostDetailResponse,
  PostView,
  ProfileView,
  UserListResponse,
  UserSummary,
} from "@vybz/core";
import { type Executor, and, desc, eq, gt, inArray, isNull, lt, ne, newId, notInArray, or, schema, sql } from "@vybz/db";
import type { ViewerContext } from "@vybz/providers";
import { z } from "zod";
import { isStaff } from "./battles/access";
import { type BattleDeps, ServiceError, type UserRow, toListItems, usersById } from "./battles/service";
import { CatalogError, ensureTrack } from "./catalog";
import { savedTracks, summaries } from "./library";
import { blocklistFromEnv } from "./live";
import { createNotifications } from "./notifications";

/**
 * The social layer: follows, blocks, posts with likes and comments, and
 * one-to-one messages. Blocking hides two people from each other everywhere.
 */

const POST_MAX = 1000;
const COMMENT_MAX = 500;
const MESSAGE_MAX = 1000;

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  return user;
}

function summary(u: UserRow): UserSummary {
  return { id: u.id, handle: u.handle, displayName: u.name, image: u.image };
}

export async function userByHandle(db: Executor, handle: string): Promise<UserRow> {
  const [u] = await db.select().from(schema.user).where(eq(schema.user.handle, handle.replace(/^@/, "").toLowerCase()));
  if (!u) throw new ServiceError(404, "NOT_FOUND", "No such user");
  return u;
}

/** Text checks shared by posts, comments and messages. */
function cleanText(raw: unknown, max: number, what: string, allowEmpty = false): string {
  const text = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "";
  if ((!text && !allowEmpty) || text.length > max) throw new ServiceError(400, "INVALID_TEXT", `${what} must be 1–${max} characters.`);
  if (!text) return text;
  const lower = text.toLowerCase();
  if (blocklistFromEnv().some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower))) {
    throw new ServiceError(400, "MESSAGE_BLOCKED", "That breaks the community rules.");
  }
  return text;
}

/** At most `max` rows by this user in the last `windowMs`. */
async function rateLimit(db: Executor, table: typeof schema.post | typeof schema.postComment | typeof schema.directMessage, userCol: "authorId" | "senderId", userId: string, max: number, windowMs: number) {
  const col = (table as unknown as Record<string, Parameters<typeof eq>[0]>)[userCol]!;
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(and(eq(col, userId), gt(table.createdAt, new Date(Date.now() - windowMs))))) as [{ n: number }];
  if (n >= max) throw new ServiceError(429, "SLOW_DOWN");
}

// ── Blocks ─────────────────────────────────────────────────────────────────

/** Everyone this user blocked or was blocked by. */
export async function blockedIds(db: Executor, userId: string): Promise<string[]> {
  const rows = await db
    .select({ a: schema.block.blockerId, b: schema.block.blockedId })
    .from(schema.block)
    .where(or(eq(schema.block.blockerId, userId), eq(schema.block.blockedId, userId)));
  return [...new Set(rows.map((r) => (r.a === userId ? r.b : r.a)))];
}

export async function isBlockedBetween(db: Executor, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ x: schema.block.blockerId })
    .from(schema.block)
    .where(or(and(eq(schema.block.blockerId, a), eq(schema.block.blockedId, b)), and(eq(schema.block.blockerId, b), eq(schema.block.blockedId, a))));
  return Boolean(row);
}

export async function blockUser(deps: BattleDeps, user: UserRow | null, handle: string): Promise<void> {
  const me = requireUser(user);
  const other = await userByHandle(deps.db, handle);
  if (other.id === me.id) throw new ServiceError(400, "INVALID_REQUEST", "You can't block yourself.");
  await deps.db.transaction(async (tx) => {
    await tx.insert(schema.block).values({ blockerId: me.id, blockedId: other.id }).onConflictDoNothing();
    await tx.delete(schema.follow).where(or(and(eq(schema.follow.followerId, me.id), eq(schema.follow.followeeId, other.id)), and(eq(schema.follow.followerId, other.id), eq(schema.follow.followeeId, me.id))));
  });
}

export async function unblockUser(deps: BattleDeps, user: UserRow | null, handle: string): Promise<void> {
  const me = requireUser(user);
  const other = await userByHandle(deps.db, handle);
  await deps.db.delete(schema.block).where(and(eq(schema.block.blockerId, me.id), eq(schema.block.blockedId, other.id)));
}

// ── Follows ────────────────────────────────────────────────────────────────

async function follows(db: Executor, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ x: schema.follow.followerId })
    .from(schema.follow)
    .where(and(eq(schema.follow.followerId, a), eq(schema.follow.followeeId, b)));
  return Boolean(row);
}

export async function followUser(deps: BattleDeps, user: UserRow | null, handle: string): Promise<void> {
  const me = requireUser(user);
  const other = await userByHandle(deps.db, handle);
  if (other.id === me.id) throw new ServiceError(400, "INVALID_REQUEST", "You can't follow yourself.");
  if (await isBlockedBetween(deps.db, me.id, other.id)) throw new ServiceError(403, "BLOCKED", "You can't follow this person.");
  const [{ n }] = (await deps.db.select({ n: sql<number>`count(*)::int` }).from(schema.follow).where(eq(schema.follow.followerId, me.id))) as [{ n: number }];
  if (n >= 5000) throw new ServiceError(409, "TOO_MANY_FOLLOWS", "You follow the maximum number of people.");
  const inserted = await deps.db.insert(schema.follow).values({ followerId: me.id, followeeId: other.id }).onConflictDoNothing().returning();
  if (inserted.length) {
    await createNotifications(deps.db, deps.push, [
      { userId: other.id, type: "NEW_FOLLOWER", title: "New follower", body: `@${me.handle} followed you.`, battleId: null, link: `/user/${me.handle}` },
    ]);
    await checkAchievements(deps.db, deps.push, [other.id]);
  }
}

export async function unfollowUser(deps: BattleDeps, user: UserRow | null, handle: string): Promise<void> {
  const me = requireUser(user);
  const other = await userByHandle(deps.db, handle);
  await deps.db.delete(schema.follow).where(and(eq(schema.follow.followerId, me.id), eq(schema.follow.followeeId, other.id)));
}

async function withViewerFollows(db: Executor, viewer: UserRow | null, users: UserSummary[]) {
  if (!viewer || !users.length) return users.map((u) => ({ ...u, viewerFollows: false }));
  const rows = await db
    .select({ id: schema.follow.followeeId })
    .from(schema.follow)
    .where(and(eq(schema.follow.followerId, viewer.id), inArray(schema.follow.followeeId, users.map((u) => u.id))));
  const set = new Set(rows.map((r) => r.id));
  return users.map((u) => ({ ...u, viewerFollows: set.has(u.id) }));
}

export async function followList(deps: BattleDeps, viewer: UserRow | null, handle: string, which: "followers" | "following"): Promise<UserListResponse> {
  const u = await userByHandle(deps.db, handle);
  const f = schema.follow;
  const rows =
    which === "followers"
      ? await deps.db.select({ id: f.followerId }).from(f).where(eq(f.followeeId, u.id)).orderBy(desc(f.createdAt)).limit(200)
      : await deps.db.select({ id: f.followeeId }).from(f).where(eq(f.followerId, u.id)).orderBy(desc(f.createdAt)).limit(200);
  const hidden = viewer ? new Set(await blockedIds(deps.db, viewer.id)) : new Set<string>();
  const people = await usersById(deps.db, rows.map((r) => r.id).filter((id) => !hidden.has(id)));
  const ordered = rows.map((r) => people.get(r.id)).filter((x): x is UserSummary => Boolean(x));
  return { items: await withViewerFollows(deps.db, viewer, ordered) };
}

/** People to follow: those who follow you, people you've battled, then top players. */
export async function peopleSuggestions(deps: BattleDeps, user: UserRow | null): Promise<{ items: PeopleSuggestion[] }> {
  const me = requireUser(user);
  const exclude = new Set([me.id, ...(await blockedIds(deps.db, me.id))]);
  const following = await deps.db.select({ id: schema.follow.followeeId }).from(schema.follow).where(eq(schema.follow.followerId, me.id));
  for (const f of following) exclude.add(f.id);
  const reasons = new Map<string, string>();
  const add = (ids: string[], reason: string) => {
    for (const id of ids) if (!exclude.has(id) && !reasons.has(id)) reasons.set(id, reason);
  };

  const followers = await deps.db.select({ id: schema.follow.followerId }).from(schema.follow).where(eq(schema.follow.followeeId, me.id)).orderBy(desc(schema.follow.createdAt)).limit(20);
  add(followers.map((r) => r.id), "Follows you");

  const p = schema.battleParticipant;
  const myBattles = deps.db.select({ id: p.battleId }).from(p).where(eq(p.userId, me.id));
  const opponents = await deps.db.select({ id: p.userId }).from(p).where(and(inArray(p.battleId, myBattles), ne(p.userId, me.id))).limit(40);
  add(opponents.map((r) => r.id), "Battled you");

  const b = schema.battle;
  const top = await deps.db
    .select({ id: p.userId, wins: sql<number>`count(*)::int` })
    .from(p)
    .innerJoin(b, eq(b.id, p.battleId))
    .where(and(eq(b.status, "COMPLETE"), eq(b.winnerParticipantId, p.id)))
    .groupBy(p.userId)
    .orderBy(desc(sql`count(*)`))
    .limit(30);
  add(top.map((r) => r.id), "Top player");

  const candidates = [...reasons.keys()];
  const system = candidates.length
    ? new Set((await deps.db.select({ id: schema.user.id }).from(schema.user).where(and(inArray(schema.user.id, candidates), eq(schema.user.isSystem, true)))).map((r) => r.id))
    : new Set<string>();
  const ids = candidates.filter((id) => !system.has(id)).slice(0, 12);
  const people = await usersById(deps.db, ids);
  return { items: ids.flatMap((id) => (people.get(id) ? [{ ...people.get(id)!, viewerFollows: false, reason: reasons.get(id)! }] : [])) };
}

/** Counts and the viewer's relationship, for a profile. */
export async function socialFor(db: Executor, viewer: UserRow | null, userId: string): Promise<ProfileView["social"]> {
  const [[a], [b], [c]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.follow).where(eq(schema.follow.followeeId, userId)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.follow).where(eq(schema.follow.followerId, userId)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.post).where(and(eq(schema.post.authorId, userId), isNull(schema.post.hiddenAt))),
  ]);
  let rel: ProfileView["social"]["viewer"] = null;
  if (viewer && viewer.id !== userId) {
    const [f1, f2, blocked] = await Promise.all([follows(db, viewer.id, userId), follows(db, userId, viewer.id), isBlockedBetween(db, viewer.id, userId)]);
    rel = { follows: f1, followedBy: f2, blocked, canMessage: !blocked && (f1 || f2) };
  }
  return { followers: a?.n ?? 0, following: b?.n ?? 0, posts: c?.n ?? 0, viewer: rel };
}

// ── Posts ──────────────────────────────────────────────────────────────────

type PostRow = typeof schema.post.$inferSelect;

const CreatePostSchema = z
  .object({
    body: z.string(),
    gif: z.unknown().optional(),
    trackId: z.string().min(1).max(40).optional(),
    catalogId: z.string().min(3).max(80).optional(),
    playlistId: z.string().min(1).max(40).optional(),
    battleId: z.string().min(1).max(40).optional(),
  })
  .strict()
  .refine((b) => [b.trackId, b.catalogId, b.playlistId, b.battleId].filter(Boolean).length <= 1, { message: "Attach one thing at most." });

export async function createPost(deps: BattleDeps, user: UserRow | null, body: unknown): Promise<{ id: string }> {
  const me = requireUser(user);
  const parsed = CreatePostSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  const gif = parseGif(parsed.data.gif);
  const text = cleanText(parsed.data.body, POST_MAX, "Posts", Boolean(gif));
  await rateLimit(deps.db, schema.post, "authorId", me.id, 1, 10_000);
  await rateLimit(deps.db, schema.post, "authorId", me.id, 20, 3600_000);

  let trackId: string | null = parsed.data.trackId ?? null;
  if (parsed.data.catalogId) {
    try {
      trackId = (await ensureTrack(deps.db, { ...deps.catalog, youtube: null }, parsed.data.catalogId)).track.id;
    } catch (err) {
      if (err instanceof CatalogError) throw new ServiceError(err.code === "TRACK_NOT_FOUND" ? 404 : 400, err.code);
      throw err;
    }
  } else if (trackId) {
    const [t] = await deps.db.select({ id: schema.track.id }).from(schema.track).where(eq(schema.track.id, trackId));
    if (!t) throw new ServiceError(404, "TRACK_NOT_FOUND");
  }
  const playlistId = parsed.data.playlistId ?? null;
  if (playlistId) {
    const [pl] = await deps.db.select().from(schema.playlist).where(eq(schema.playlist.id, playlistId));
    // Only public playlists can be shared to the feed; private ones go by link.
    if (!pl || pl.visibility !== "PUBLIC") throw new ServiceError(400, "PLAYLIST_NOT_PUBLIC", "Make the playlist public to share it here.");
  }
  const battleId = parsed.data.battleId ?? null;
  if (battleId) {
    const [bt] = await deps.db.select().from(schema.battle).where(eq(schema.battle.id, battleId));
    if (!bt || bt.visibility !== "PUBLIC") throw new ServiceError(400, "BATTLE_NOT_PUBLIC", "Only public battles can be shared to the feed.");
  }

  const id = newId();
  await deps.db.insert(schema.post).values({ id, authorId: me.id, body: text, gif, trackId, playlistId, battleId });
  try {
    await awardPost(deps.db, me.id, id);
  } catch (err) {
    console.error("post award failed", id, err);
  }
  await checkAchievements(deps.db, deps.push, [me.id]);
  return { id };
}

async function postViews(deps: BattleDeps, viewer: UserRow | null, rows: PostRow[], ctx: ViewerContext): Promise<PostView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const trackIds = rows.map((r) => r.trackId).filter((x): x is string => Boolean(x));
  const playlistIds = rows.map((r) => r.playlistId).filter((x): x is string => Boolean(x));
  const battleIds = rows.map((r) => r.battleId).filter((x): x is string => Boolean(x));
  const [authors, likes, comments, mine, tracks, playlists, battles] = await Promise.all([
    usersById(deps.db, [...new Set(rows.map((r) => r.authorId))]),
    deps.db.select({ id: schema.postLike.postId, n: sql<number>`count(*)::int` }).from(schema.postLike).where(inArray(schema.postLike.postId, ids)).groupBy(schema.postLike.postId),
    deps.db
      .select({ id: schema.postComment.postId, n: sql<number>`count(*)::int` })
      .from(schema.postComment)
      .where(and(inArray(schema.postComment.postId, ids), isNull(schema.postComment.hiddenAt)))
      .groupBy(schema.postComment.postId),
    viewer
      ? deps.db.select({ id: schema.postLike.postId }).from(schema.postLike).where(and(inArray(schema.postLike.postId, ids), eq(schema.postLike.userId, viewer.id)))
      : Promise.resolve([] as { id: string }[]),
    savedTracks(deps.db, deps.catalog, trackIds, ctx),
    playlistIds.length ? deps.db.select().from(schema.playlist).where(and(inArray(schema.playlist.id, playlistIds), eq(schema.playlist.visibility, "PUBLIC"))).then((r) => summaries(deps.db, r)) : Promise.resolve([]),
    battleIds.length ? deps.db.select().from(schema.battle).where(and(inArray(schema.battle.id, battleIds), eq(schema.battle.visibility, "PUBLIC"))).then((r) => toListItems(deps, viewer, r)) : Promise.resolve([]),
  ]);
  const likeN = new Map(likes.map((l) => [l.id, l.n]));
  const commentN = new Map(comments.map((c) => [c.id, c.n]));
  const liked = new Set(mine.map((m) => m.id));
  const staff = isStaff(viewer);
  return rows.map((r) => {
    let attachment: PostAttachment | null = null;
    if (r.trackId && tracks.get(r.trackId)) attachment = { kind: "track", track: tracks.get(r.trackId)! };
    const pl = r.playlistId ? playlists.find((p) => p.id === r.playlistId) : undefined;
    if (pl) attachment = { kind: "playlist", playlist: pl };
    const bt = r.battleId ? battles.find((b) => b.id === r.battleId) : undefined;
    if (bt) attachment = { kind: "battle", battle: bt };
    return {
      id: r.id,
      author: authors.get(r.authorId) ?? { id: r.authorId, handle: "unknown", displayName: "Unknown", image: null },
      body: r.body,
      gif: storedGif(r.gif),
      createdAt: r.createdAt.toISOString(),
      attachment,
      likes: likeN.get(r.id) ?? 0,
      comments: commentN.get(r.id) ?? 0,
      viewer: viewer ? { liked: liked.has(r.id), canDelete: viewer.id === r.authorId || staff } : null,
    };
  });
}

/** Cursor: "<ISO time>_<id>" of the last post shown. */
function parseCursor(raw: string | null): { at: Date; id: string } | null {
  if (!raw) return null;
  const i = raw.lastIndexOf("_");
  const at = new Date(raw.slice(0, i));
  if (i < 0 || Number.isNaN(at.getTime())) throw new ServiceError(400, "INVALID_QUERY");
  return { at, id: raw.slice(i + 1) };
}

export async function feed(
  deps: BattleDeps,
  viewer: UserRow | null,
  kind: { kind: "following" } | { kind: "for_you" } | { kind: "user"; handle: string },
  before: string | null,
  ctx: ViewerContext,
  limit = 20,
): Promise<FeedResponse> {
  const p = schema.post;
  const conds = [isNull(p.hiddenAt)];
  if (viewer) {
    const hidden = await blockedIds(deps.db, viewer.id);
    if (hidden.length) conds.push(notInArray(p.authorId, hidden));
  }
  if (kind.kind === "following") {
    const me = requireUser(viewer);
    const followed = deps.db.select({ id: schema.follow.followeeId }).from(schema.follow).where(eq(schema.follow.followerId, me.id));
    conds.push(or(eq(p.authorId, me.id), inArray(p.authorId, followed))!);
  } else if (kind.kind === "user") {
    const u = await userByHandle(deps.db, kind.handle);
    conds.push(eq(p.authorId, u.id));
  }
  const cursor = parseCursor(before);
  if (cursor) conds.push(or(lt(p.createdAt, cursor.at), and(eq(p.createdAt, cursor.at), lt(p.id, cursor.id)))!);
  const rows = await deps.db.select().from(p).where(and(...conds)).orderBy(desc(p.createdAt), desc(p.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { items: await postViews(deps, viewer, page, ctx), nextCursor: rows.length > limit && last ? `${last.createdAt.toISOString()}_${last.id}` : null };
}

async function visiblePost(deps: BattleDeps, viewer: UserRow | null, id: string): Promise<PostRow> {
  const [row] = await deps.db.select().from(schema.post).where(eq(schema.post.id, id));
  if (!row || (row.hiddenAt && !isStaff(viewer))) throw new ServiceError(404, "NOT_FOUND");
  if (viewer && (await isBlockedBetween(deps.db, viewer.id, row.authorId))) throw new ServiceError(404, "NOT_FOUND");
  return row;
}

export async function getPost(deps: BattleDeps, viewer: UserRow | null, id: string, ctx: ViewerContext): Promise<PostDetailResponse> {
  const row = await visiblePost(deps, viewer, id);
  const hidden = viewer ? await blockedIds(deps.db, viewer.id) : [];
  const c = schema.postComment;
  const rows = await deps.db
    .select()
    .from(c)
    .where(and(eq(c.postId, id), isNull(c.hiddenAt), ...(hidden.length ? [notInArray(c.authorId, hidden)] : [])))
    .orderBy(c.createdAt)
    .limit(200);
  const ids = rows.map((r) => r.id);
  const [authors, likeRows, mine] = await Promise.all([
    usersById(deps.db, [...new Set(rows.map((r) => r.authorId))]),
    ids.length
      ? deps.db
          .select({ id: schema.commentLike.commentId, n: sql<number>`count(*)::int` })
          .from(schema.commentLike)
          .where(inArray(schema.commentLike.commentId, ids))
          .groupBy(schema.commentLike.commentId)
      : Promise.resolve([] as { id: string; n: number }[]),
    viewer && ids.length
      ? deps.db.select({ id: schema.commentLike.commentId }).from(schema.commentLike).where(and(inArray(schema.commentLike.commentId, ids), eq(schema.commentLike.userId, viewer.id)))
      : Promise.resolve([] as { id: string }[]),
  ]);
  const likeN = new Map(likeRows.map((l) => [l.id, l.n]));
  const liked = new Set(mine.map((m) => m.id));
  const staff = isStaff(viewer);
  const comments: CommentView[] = rows.map((r) => ({
    id: r.id,
    author: authors.get(r.authorId) ?? { id: r.authorId, handle: "unknown", displayName: "Unknown", image: null },
    body: r.body,
    gif: storedGif(r.gif),
    createdAt: r.createdAt.toISOString(),
    canDelete: Boolean(viewer && (viewer.id === r.authorId || viewer.id === row.authorId || staff)),
    likes: likeN.get(r.id) ?? 0,
    liked: liked.has(r.id),
  }));
  const [post] = await postViews(deps, viewer, [row], ctx);
  return { post: post!, comments };
}

export async function deletePost(deps: BattleDeps, user: UserRow | null, id: string): Promise<void> {
  const me = requireUser(user);
  const [row] = await deps.db.select().from(schema.post).where(eq(schema.post.id, id));
  if (!row) throw new ServiceError(404, "NOT_FOUND");
  if (row.authorId !== me.id && !isStaff(me)) throw new ServiceError(403, "FORBIDDEN");
  await deps.db.delete(schema.post).where(eq(schema.post.id, id));
}

export async function setLike(deps: BattleDeps, user: UserRow | null, id: string, liked: boolean): Promise<void> {
  const me = requireUser(user);
  const row = await visiblePost(deps, me, id);
  if (!liked) {
    await deps.db.delete(schema.postLike).where(and(eq(schema.postLike.postId, id), eq(schema.postLike.userId, me.id)));
    return;
  }
  const inserted = await deps.db.insert(schema.postLike).values({ postId: id, userId: me.id }).onConflictDoNothing().returning();
  if (!inserted.length || row.authorId === me.id) return;
  // One notification per person per post, even if they unlike and like again.
  const link = `/post/${id}`;
  const body = `@${me.handle} liked your post.`;
  const [already] = await deps.db
    .select({ id: schema.notification.id })
    .from(schema.notification)
    .where(and(eq(schema.notification.userId, row.authorId), eq(schema.notification.type, "POST_LIKED"), eq(schema.notification.link, link), eq(schema.notification.body, body)));
  if (!already) await createNotifications(deps.db, deps.push, [{ userId: row.authorId, type: "POST_LIKED", title: "New like", body, battleId: null, link }]);
}

export async function addComment(deps: BattleDeps, user: UserRow | null, id: string, body: unknown): Promise<CommentView> {
  const me = requireUser(user);
  const row = await visiblePost(deps, me, id);
  const gif = parseGif((body as { gif?: unknown } | null)?.gif);
  const text = cleanText((body as { body?: unknown } | null)?.body, COMMENT_MAX, "Comments", Boolean(gif));
  await rateLimit(deps.db, schema.postComment, "authorId", me.id, 1, 3000);
  await rateLimit(deps.db, schema.postComment, "authorId", me.id, 30, 600_000);
  const cid = newId();
  const [c] = await deps.db.insert(schema.postComment).values({ id: cid, postId: id, authorId: me.id, body: text, gif }).returning();
  if (row.authorId !== me.id) {
    await createNotifications(deps.db, deps.push, [
      { userId: row.authorId, type: "POST_COMMENT", title: "New comment", body: `@${me.handle}: ${text ? text.slice(0, 80) : "sent a GIF"}`, battleId: null, link: `/post/${id}` },
    ]);
  }
  return { id: cid, author: summary(me), body: text, gif, createdAt: c!.createdAt.toISOString(), canDelete: true, likes: 0, liked: false };
}

/** Like or unlike a comment. The author hears about it once per person. */
export async function setCommentLike(deps: BattleDeps, user: UserRow | null, commentId: string, liked: boolean): Promise<{ likes: number; liked: boolean }> {
  const me = requireUser(user);
  const [c] = await deps.db.select().from(schema.postComment).where(eq(schema.postComment.id, commentId));
  if (!c || c.hiddenAt) throw new ServiceError(404, "NOT_FOUND");
  await visiblePost(deps, me, c.postId);
  if (await isBlockedBetween(deps.db, me.id, c.authorId)) throw new ServiceError(404, "NOT_FOUND");
  if (!liked) {
    await deps.db.delete(schema.commentLike).where(and(eq(schema.commentLike.commentId, commentId), eq(schema.commentLike.userId, me.id)));
  } else {
    const inserted = await deps.db.insert(schema.commentLike).values({ commentId, userId: me.id }).onConflictDoNothing().returning();
    if (inserted.length && c.authorId !== me.id) {
      const link = `/post/${c.postId}`;
      const nbody = `@${me.handle} liked your comment.`;
      const [already] = await deps.db
        .select({ id: schema.notification.id })
        .from(schema.notification)
        .where(and(eq(schema.notification.userId, c.authorId), eq(schema.notification.type, "COMMENT_LIKED"), eq(schema.notification.link, link), eq(schema.notification.body, nbody)));
      if (!already) await createNotifications(deps.db, deps.push, [{ userId: c.authorId, type: "COMMENT_LIKED", title: "New like", body: nbody, battleId: null, link }]);
    }
  }
  const [{ n }] = (await deps.db.select({ n: sql<number>`count(*)::int` }).from(schema.commentLike).where(eq(schema.commentLike.commentId, commentId))) as [{ n: number }];
  return { likes: n, liked };
}

export async function deleteComment(deps: BattleDeps, user: UserRow | null, commentId: string): Promise<void> {
  const me = requireUser(user);
  const [c] = await deps.db.select().from(schema.postComment).where(eq(schema.postComment.id, commentId));
  if (!c) throw new ServiceError(404, "NOT_FOUND");
  const [p] = await deps.db.select({ authorId: schema.post.authorId }).from(schema.post).where(eq(schema.post.id, c.postId));
  if (c.authorId !== me.id && p?.authorId !== me.id && !isStaff(me)) throw new ServiceError(403, "FORBIDDEN");
  await deps.db.delete(schema.postComment).where(eq(schema.postComment.id, commentId));
}

// ── Messages ───────────────────────────────────────────────────────────────

type ConversationRow = typeof schema.conversation.$inferSelect;

/** Two people can message when neither blocked the other and at least one follows the other. */
async function messagingState(db: Executor, a: string, b: string): Promise<"OK" | "BLOCKED" | "NOT_CONNECTED"> {
  if (await isBlockedBetween(db, a, b)) return "BLOCKED";
  return (await follows(db, a, b)) || (await follows(db, b, a)) ? "OK" : "NOT_CONNECTED";
}

function sides(c: ConversationRow, me: string) {
  const mineIsA = c.userA === me;
  return { other: mineIsA ? c.userB : c.userA, myRead: mineIsA ? c.aReadAt : c.bReadAt, otherRead: mineIsA ? c.bReadAt : c.aReadAt, mineIsA };
}

async function myConversation(db: Executor, me: UserRow, id: string): Promise<ConversationRow> {
  const [c] = await db.select().from(schema.conversation).where(eq(schema.conversation.id, id));
  if (!c || (c.userA !== me.id && c.userB !== me.id)) throw new ServiceError(404, "NOT_FOUND");
  return c;
}

/** The conversation with someone, created on first use. */
export async function openConversation(deps: BattleDeps, user: UserRow | null, handle: string): Promise<{ id: string }> {
  const me = requireUser(user);
  const other = await userByHandle(deps.db, handle);
  if (other.id === me.id) throw new ServiceError(400, "INVALID_REQUEST", "You can't message yourself.");
  const [userA, userB] = me.id < other.id ? [me.id, other.id] : [other.id, me.id];
  const [existing] = await deps.db.select().from(schema.conversation).where(and(eq(schema.conversation.userA, userA), eq(schema.conversation.userB, userB)));
  if (existing) return { id: existing.id };
  const state = await messagingState(deps.db, me.id, other.id);
  if (state !== "OK") throw new ServiceError(403, state === "BLOCKED" ? "BLOCKED" : "NOT_CONNECTED", state === "BLOCKED" ? "You can't message this person." : "You can message people once one of you follows the other.");
  const id = newId();
  await deps.db.insert(schema.conversation).values({ id, userA, userB }).onConflictDoNothing();
  const [row] = await deps.db.select().from(schema.conversation).where(and(eq(schema.conversation.userA, userA), eq(schema.conversation.userB, userB)));
  return { id: row!.id };
}

export async function inbox(deps: BattleDeps, user: UserRow | null): Promise<InboxResponse> {
  const me = requireUser(user);
  const c = schema.conversation;
  const rows = await deps.db
    .select()
    .from(c)
    .where(and(or(eq(c.userA, me.id), eq(c.userB, me.id)), sql`${c.lastMessageAt} is not null`))
    .orderBy(desc(c.lastMessageAt))
    .limit(100);
  if (!rows.length) return { items: [], unread: 0 };
  const hidden = new Set(await blockedIds(deps.db, me.id));
  const visible = rows.filter((r) => !hidden.has(sides(r, me.id).other));
  const [people, lasts] = await Promise.all([
    usersById(deps.db, visible.map((r) => sides(r, me.id).other)),
    deps.db
      .selectDistinctOn([schema.directMessage.conversationId])
      .from(schema.directMessage)
      .where(and(inArray(schema.directMessage.conversationId, visible.map((r) => r.id)), isNull(schema.directMessage.hiddenAt)))
      .orderBy(schema.directMessage.conversationId, desc(schema.directMessage.createdAt)),
  ]);
  const items = visible.flatMap((r) => {
    const s = sides(r, me.id);
    const other = people.get(s.other);
    if (!other) return [];
    const last = lasts.find((m) => m.conversationId === r.id);
    const unread = Boolean(last && last.senderId !== me.id && (!s.myRead || last.createdAt > s.myRead));
    return [{ id: r.id, other, lastMessage: last ? { body: last.body || (last.gif ? "GIF" : ""), createdAt: last.createdAt.toISOString(), fromMe: last.senderId === me.id } : null, unread }];
  });
  return { items, unread: items.filter((i) => i.unread).length };
}

export async function getConversation(deps: BattleDeps, user: UserRow | null, id: string): Promise<ConversationView> {
  const me = requireUser(user);
  const c = await myConversation(deps.db, me, id);
  const s = sides(c, me.id);
  const [people, rows, state] = await Promise.all([
    usersById(deps.db, [s.other]),
    deps.db
      .select()
      .from(schema.directMessage)
      .where(and(eq(schema.directMessage.conversationId, id), isNull(schema.directMessage.hiddenAt)))
      .orderBy(desc(schema.directMessage.createdAt))
      .limit(100),
    messagingState(deps.db, me.id, s.other),
  ]);
  // Opening the conversation marks it read.
  await deps.db
    .update(schema.conversation)
    .set(s.mineIsA ? { aReadAt: new Date() } : { bReadAt: new Date() })
    .where(eq(schema.conversation.id, id));
  return {
    id,
    other: people.get(s.other) ?? { id: s.other, handle: "unknown", displayName: "Unknown", image: null },
    messages: rows.reverse().map((m) => ({ id: m.id, body: m.body, gif: storedGif(m.gif), createdAt: m.createdAt.toISOString(), fromMe: m.senderId === me.id })),
    canSend: state === "OK",
    blockedReason: state === "OK" ? null : state,
  };
}

export async function sendMessage(deps: BattleDeps, user: UserRow | null, id: string, body: unknown) {
  const me = requireUser(user);
  const c = await myConversation(deps.db, me, id);
  const s = sides(c, me.id);
  const state = await messagingState(deps.db, me.id, s.other);
  if (state !== "OK") throw new ServiceError(403, state, state === "BLOCKED" ? "You can't message this person." : "You can message people once one of you follows the other.");
  const gif = parseGif((body as { gif?: unknown } | null)?.gif);
  const text = cleanText((body as { body?: unknown } | null)?.body, MESSAGE_MAX, "Messages", Boolean(gif));
  await rateLimit(deps.db, schema.directMessage, "senderId", me.id, 1, 700);
  await rateLimit(deps.db, schema.directMessage, "senderId", me.id, 40, 60_000);
  const now = new Date();
  const mid = newId();
  await deps.db.insert(schema.directMessage).values({ id: mid, conversationId: id, senderId: me.id, body: text, gif, createdAt: now });
  await deps.db
    .update(schema.conversation)
    .set({ lastMessageAt: now, ...(s.mineIsA ? { aReadAt: now } : { bReadAt: now }) })
    .where(eq(schema.conversation.id, id));
  // Notify when this starts a new unread stretch for them, not on every message.
  const caughtUp = !c.lastMessageAt || (s.otherRead !== null && s.otherRead >= c.lastMessageAt);
  if (caughtUp) {
    await createNotifications(deps.db, deps.push, [
      { userId: s.other, type: "NEW_MESSAGE", title: `@${me.handle}`, body: text ? text.slice(0, 100) : "Sent a GIF", battleId: null, link: `/messages/${id}` },
    ]);
  }
  return { id: mid, body: text, gif, createdAt: now.toISOString(), fromMe: true };
}
