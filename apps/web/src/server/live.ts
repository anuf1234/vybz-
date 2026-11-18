import { parseGif, storedGif } from "./gifs";
import { type ChatMessageView, type LiveView, REACTIONS, type Reaction } from "@vybz/core";
import { and, eq, gt, gte, inArray, isNull, newId, schema, sql } from "@vybz/db";
import { canViewBattle, isStaff } from "./battles/access";
import { type BattleDeps, ServiceError, type UserRow, usersById } from "./battles/service";

/**
 * The live layer: chat, reactions and viewer counts. Stored in Postgres and
 * read by polling (the app polls every few seconds while a battle is open).
 * A managed realtime service (Ably, per the architecture plan) can publish the
 * same rows later without changing these rules.
 */

export const PRESENCE_WINDOW_MS = 30_000;
const CHAT_MAX = 280;
const CHAT_MIN_GAP_MS = 2_000;
const CHAT_PER_MINUTE = 15;
const REACTIONS_PER_10S = 10;

const now = (deps: BattleDeps) => deps.now?.() ?? new Date();

/** Who's watching: signed-in users by id, guests by a random key the app sends. */
export function viewerKey(user: UserRow | null, guestKey: string | null): string | null {
  if (user) return `u:${user.id}`;
  return guestKey && /^[A-Za-z0-9_-]{8,64}$/.test(guestKey) ? `g:${guestKey}` : null;
}

async function battleFor(deps: BattleDeps, id: string, viewer: UserRow | null) {
  const [row] = await deps.db.select().from(schema.battle).where(eq(schema.battle.id, id));
  if (!row || !(await canViewBattle(deps.db, row, viewer))) throw new ServiceError(404, "NOT_FOUND", "Battle not found");
  return row;
}

/** Blocked words come from CHAT_BLOCKLIST (comma-separated). Links are never allowed in chat. */
export function chatProblem(body: string, blocklist: string[]): string | null {
  if (/(https?:\/\/|www\.)\S+/i.test(body) || /\b[a-z0-9-]+\.(com|net|org|io|gg|ly|co|app)\b/i.test(body)) return "Links aren't allowed in chat.";
  const lower = body.toLowerCase();
  if (blocklist.some((w) => w && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower))) return "That message breaks the chat rules.";
  return null;
}

export function blocklistFromEnv(raw = process.env.CHAT_BLOCKLIST ?? ""): string[] {
  return raw
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

export async function postChat(deps: BattleDeps, user: UserRow | null, id: string, body: unknown, blocklist = blocklistFromEnv(), gifIn?: unknown): Promise<ChatMessageView> {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  const gif = parseGif(gifIn);
  const text = typeof body === "string" ? body.replace(/\s+/g, " ").trim() : "";
  if ((!text && !gif) || text.length > CHAT_MAX) throw new ServiceError(400, "INVALID_MESSAGE", `Messages are 1–${CHAT_MAX} characters.`);
  const row = await battleFor(deps, id, user);
  if (row.status === "CANCELLED" || row.status === "EXPIRED" || row.status === "VOIDED") throw new ServiceError(409, "CHAT_CLOSED");
  const problem = text ? chatProblem(text, blocklist) : null;
  if (problem) throw new ServiceError(400, "MESSAGE_BLOCKED", problem);

  const t = now(deps);
  const recent = await deps.db
    .select({ createdAt: schema.chatMessage.createdAt })
    .from(schema.chatMessage)
    .where(and(eq(schema.chatMessage.userId, user.id), gte(schema.chatMessage.createdAt, new Date(t.getTime() - 60_000))))
    .orderBy(sql`${schema.chatMessage.createdAt} desc`);
  if (recent.length >= CHAT_PER_MINUTE || (recent[0] && t.getTime() - recent[0].createdAt.getTime() < CHAT_MIN_GAP_MS)) {
    throw new ServiceError(429, "SLOW_DOWN", "You're sending messages too fast.");
  }

  const msg = { id: newId(), battleId: id, userId: user.id, body: text, gif, createdAt: t };
  await deps.db.insert(schema.chatMessage).values(msg);
  return { id: msg.id, user: { id: user.id, handle: user.handle, displayName: user.name, image: user.image }, body: text, gif, likes: 0, liked: false, createdAt: t.toISOString(), hidden: false };
}

/** Like or unlike someone's chat message. */
export async function setChatLike(deps: BattleDeps, user: UserRow | null, battleId: string, messageId: string, liked: boolean): Promise<{ likes: number; liked: boolean }> {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  await battleFor(deps, battleId, user);
  const [m] = await deps.db.select().from(schema.chatMessage).where(and(eq(schema.chatMessage.id, messageId), eq(schema.chatMessage.battleId, battleId)));
  if (!m || m.hiddenAt) throw new ServiceError(404, "NOT_FOUND");
  if (liked) await deps.db.insert(schema.chatLike).values({ messageId, userId: user.id }).onConflictDoNothing();
  else await deps.db.delete(schema.chatLike).where(and(eq(schema.chatLike.messageId, messageId), eq(schema.chatLike.userId, user.id)));
  const [{ n } = { n: 0 }] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(schema.chatLike).where(eq(schema.chatLike.messageId, messageId));
  return { likes: n, liked };
}

export async function react(deps: BattleDeps, user: UserRow | null, id: string, emoji: unknown, guestKey: string | null): Promise<void> {
  if (typeof emoji !== "string" || !(REACTIONS as readonly string[]).includes(emoji)) throw new ServiceError(400, "INVALID_REACTION");
  const key = viewerKey(user, guestKey);
  if (!key) throw new ServiceError(400, "VIEWER_KEY_REQUIRED");
  if (user && user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  await battleFor(deps, id, user);
  const t = now(deps);
  const [{ n } = { n: 0 }] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.reaction)
    .where(and(eq(schema.reaction.viewerKey, key), gte(schema.reaction.createdAt, new Date(t.getTime() - 10_000))));
  if (n >= REACTIONS_PER_10S) throw new ServiceError(429, "SLOW_DOWN");
  await deps.db.insert(schema.reaction).values({ id: newId(), battleId: id, userId: user?.id ?? null, viewerKey: key, emoji, createdAt: t });
}

/** Heartbeat from an open battle screen. */
export async function heartbeat(deps: BattleDeps, user: UserRow | null, id: string, guestKey: string | null): Promise<void> {
  const key = viewerKey(user, guestKey);
  if (!key) return;
  await battleFor(deps, id, user);
  const t = now(deps);
  await deps.db
    .insert(schema.battlePresence)
    .values({ battleId: id, viewerKey: key, userId: user?.id ?? null, lastSeen: t })
    .onConflictDoUpdate({ target: [schema.battlePresence.battleId, schema.battlePresence.viewerKey], set: { lastSeen: t } });
}

/** Everything the live strip shows. `after`: only chat messages newer than this id. */
export async function liveView(deps: BattleDeps, user: UserRow | null, id: string, after: string | null): Promise<LiveView> {
  await battleFor(deps, id, user);
  const t = now(deps);
  const staff = isStaff(user);
  const msgWhere = and(eq(schema.chatMessage.battleId, id), after ? gt(schema.chatMessage.id, after) : undefined, staff ? undefined : isNull(schema.chatMessage.hiddenAt));

  const [viewers, messages, recent, totals] = await Promise.all([
    deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.battlePresence)
      .where(and(eq(schema.battlePresence.battleId, id), gte(schema.battlePresence.lastSeen, new Date(t.getTime() - PRESENCE_WINDOW_MS)))),
    // Newest 50 (or everything after `after`), returned oldest first.
    deps.db.select().from(schema.chatMessage).where(msgWhere).orderBy(sql`${schema.chatMessage.id} desc`).limit(50),
    deps.db
      .select({ emoji: schema.reaction.emoji, n: sql<number>`count(*)::int` })
      .from(schema.reaction)
      .where(and(eq(schema.reaction.battleId, id), gte(schema.reaction.createdAt, new Date(t.getTime() - 60_000))))
      .groupBy(schema.reaction.emoji),
    deps.db.select({ emoji: schema.reaction.emoji, n: sql<number>`count(*)::int` }).from(schema.reaction).where(eq(schema.reaction.battleId, id)).groupBy(schema.reaction.emoji),
  ]);
  const mids = messages.map((m) => m.id);
  const [users, likeRows, mine] = await Promise.all([
    usersById(deps.db, [...new Set(messages.map((m) => m.userId))]),
    mids.length
      ? deps.db.select({ id: schema.chatLike.messageId, n: sql<number>`count(*)::int` }).from(schema.chatLike).where(inArray(schema.chatLike.messageId, mids)).groupBy(schema.chatLike.messageId)
      : Promise.resolve([] as { id: string; n: number }[]),
    user && mids.length
      ? deps.db.select({ id: schema.chatLike.messageId }).from(schema.chatLike).where(and(inArray(schema.chatLike.messageId, mids), eq(schema.chatLike.userId, user.id)))
      : Promise.resolve([] as { id: string }[]),
  ]);
  const likeN = new Map(likeRows.map((l) => [l.id, l.n]));
  const likedSet = new Set(mine.map((x) => x.id));
  return {
    viewers: viewers[0]?.n ?? 0,
    messages: messages
      .reverse()
      .map((m) => ({
        id: m.id,
        user: users.get(m.userId)!,
        body: m.body,
        gif: storedGif(m.gif),
        likes: likeN.get(m.id) ?? 0,
        liked: likedSet.has(m.id),
        createdAt: m.createdAt.toISOString(),
        hidden: m.hiddenAt !== null,
      })),
    recentReactions: Object.fromEntries(recent.map((r) => [r.emoji as Reaction, r.n])),
    reactionTotals: Object.fromEntries(totals.map((r) => [r.emoji as Reaction, r.n])),
  };
}

