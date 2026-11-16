import { type BattleAggregate, type DomainEvent, type NotificationType, type NotificationView, awaitingResponseFrom, isDuel } from "@vybz/core";
import { type Database, type Executor, and, desc, eq, inArray, isNull, newId, schema, sql } from "@vybz/db";

/**
 * Notifications: rows in the database (the in-app list) plus a best-effort
 * push to the person's phones through Expo's push service.
 */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export type PushSender = (messages: PushMessage[]) => Promise<void>;

/** Expo push service. Tokens look like ExponentPushToken[...]. */
export function expoPushSender(opts: { accessToken?: string; fetch?: typeof fetch } = {}): PushSender {
  const doFetch = opts.fetch ?? fetch;
  return async (messages) => {
    for (let i = 0; i < messages.length; i += 100) {
      const res = await doFetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(opts.accessToken ? { authorization: `Bearer ${opts.accessToken}` } : {}),
        },
        body: JSON.stringify(messages.slice(i, i + 100).map((m) => ({ ...m, sound: "default" }))),
      });
      if (!res.ok) throw new Error(`push send failed: ${res.status}`);
    }
  };
}

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  battleId: string | null;
}

export async function createNotifications(db: Executor, push: PushSender | null | undefined, items: NewNotification[]): Promise<void> {
  if (!items.length) return;
  await db.insert(schema.notification).values(items.map((n) => ({ id: newId(), ...n })));
  if (!push) return;
  try {
    const tokens = await db.select().from(schema.pushToken).where(inArray(schema.pushToken.userId, [...new Set(items.map((i) => i.userId))]));
    const messages = items.flatMap((n) =>
      tokens.filter((t) => t.userId === n.userId).map((t) => ({ to: t.token, title: n.title, body: n.body, data: { type: n.type, ...(n.battleId ? { battleId: n.battleId } : {}) } })),
    );
    if (messages.length) await push(messages);
  } catch (err) {
    console.warn("push failed", err);
  }
}

/** Maps engine events to who should hear about them. */
export async function notifyForEvents(db: Database, push: PushSender | null | undefined, agg: BattleAggregate, title: string, events: DomainEvent[]): Promise<void> {
  if (!events.length) return;
  const players = agg.participants.map((p) => p.userId);
  const userOf = (participantId: string | null) => agg.participants.find((p) => p.id === participantId)?.userId ?? null;
  const handles = await handlesFor(db, [...players, agg.creatorId, ...(agg.invitedUserId ? [agg.invitedUserId] : [])]);
  const at = (userId: string | null | undefined) => (userId ? `@${handles.get(userId) ?? "someone"}` : "someone");
  const out: NewNotification[] = [];
  const add = (userIds: (string | null | undefined)[], type: NotificationType, t: string, body: string) => {
    for (const userId of new Set(userIds.filter((u): u is string => !!u))) out.push({ userId, type, title: t, body, battleId: agg.id });
  };
  const started = events.some((e) => e.type === "battle.started");

  for (const e of events) {
    switch (e.type) {
      case "battle.countered":
        add([awaitingResponseFrom(agg)], "COUNTERED", "New counter-offer", `${at(e.userId)} wants different terms for "${title}".`);
        break;
      case "battle.accepted":
        add([agg.creatorId].filter((u) => u !== e.userId), "CHALLENGE_ACCEPTED", "Challenge accepted", `${at(e.userId)} accepted "${title}". Make your first pick.`);
        break;
      case "battle.joined":
        if (agg.creatorId !== e.userId) add([agg.creatorId], "PLAYER_JOINED", "New player", `${at(e.userId)} joined "${title}" (${agg.participants.length}/${agg.rules.entrants.max}).`);
        break;
      case "round.submissions_opened": {
        const who = e.contenderIds.map(userOf);
        const first = e.roundIndex === 0 && started;
        add(who, "YOUR_PICK", first ? "The battle is on" : "Your pick", first ? `"${title}" started. Make your round 1 pick.` : `Round ${e.roundIndex + 1} of "${title}" is open for picks.`);
        break;
      }
      case "round.voting_opened":
        add(players, "VOTING_OPEN", "Voting is open", `All picks are in for round ${e.roundIndex + 1} of "${title}".`);
        break;
      case "round.scored": {
        const w = userOf(e.winnerParticipantId);
        add(players, "ROUND_RESULT", `Round ${e.roundIndex + 1} result`, w ? `${at(w)} took round ${e.roundIndex + 1} of "${title}".` : `Round ${e.roundIndex + 1} of "${title}" was a draw.`);
        break;
      }
      case "battle.completed": {
        const w = userOf(e.winnerParticipantId);
        add(players, "BATTLE_RESULT", "Final result", w ? `${at(w)} won "${title}".` : `"${title}" ended level.`);
        break;
      }
      default:
        break;
    }
  }
  if (!isDuel(agg.rules) && started && !events.some((e) => e.type === "round.submissions_opened")) {
    add(players, "BATTLE_STARTED", "The battle is on", `"${title}" has started.`);
  }
  await createNotifications(db, push, out);
}

async function handlesFor(db: Executor, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: schema.user.id, handle: schema.user.handle }).from(schema.user).where(inArray(schema.user.id, unique));
  return new Map(rows.map((r) => [r.id, r.handle]));
}

export async function listNotifications(db: Executor, userId: string, limit = 50): Promise<{ items: NotificationView[]; unread: number }> {
  const [rows, [count]] = await Promise.all([
    db.select().from(schema.notification).where(eq(schema.notification.userId, userId)).orderBy(desc(schema.notification.createdAt)).limit(limit),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.notification).where(and(eq(schema.notification.userId, userId), isNull(schema.notification.readAt))),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type as NotificationType,
      title: r.title,
      body: r.body,
      battleId: r.battleId,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
    })),
    unread: count?.n ?? 0,
  };
}

export async function markRead(db: Executor, userId: string, ids: string[] | "all"): Promise<void> {
  const where = ids === "all" ? and(eq(schema.notification.userId, userId), isNull(schema.notification.readAt)) : and(eq(schema.notification.userId, userId), inArray(schema.notification.id, ids));
  await db.update(schema.notification).set({ readAt: new Date() }).where(where);
}

export async function savePushToken(db: Executor, userId: string, token: string, platform: string): Promise<void> {
  await db
    .insert(schema.pushToken)
    .values({ token, userId, platform })
    .onConflictDoUpdate({ target: schema.pushToken.token, set: { userId, platform, updatedAt: new Date() } });
}

export async function removePushToken(db: Executor, userId: string, token: string): Promise<void> {
  await db.delete(schema.pushToken).where(and(eq(schema.pushToken.token, token), eq(schema.pushToken.userId, userId)));
}
