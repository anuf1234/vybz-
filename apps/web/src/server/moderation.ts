import type { ModerationAction, ModerationReportView, ReportSubject } from "@vybz/core";
import { and, desc, eq, inArray, newId, schema, sql } from "@vybz/db";
import { z } from "zod";
import { canViewBattle, isStaff } from "./battles/access";
import { type BattleDeps, ServiceError, type UserRow, usersById, voidBattleAsModerator } from "./battles/service";

/**
 * Reports from users, and the moderator queue that acts on them. Every
 * moderator action is recorded in moderation_action.
 */

const ReportSchema = z
  .object({
    subjectType: z.enum(["CHAT_MESSAGE", "BATTLE", "USER"]),
    subjectId: z.string().min(1).max(40),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export async function fileReport(deps: BattleDeps, reporter: UserRow | null, body: unknown): Promise<{ id: string }> {
  if (!reporter) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  const parsed = ReportSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  const { subjectType, subjectId, reason } = parsed.data;

  let battleId: string | null = null;
  if (subjectType === "CHAT_MESSAGE") {
    const [m] = await deps.db.select().from(schema.chatMessage).where(eq(schema.chatMessage.id, subjectId));
    if (!m) throw new ServiceError(404, "NOT_FOUND");
    battleId = m.battleId;
  } else if (subjectType === "BATTLE") {
    battleId = subjectId;
  } else {
    const [u] = await deps.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, subjectId));
    if (!u) throw new ServiceError(404, "NOT_FOUND");
    if (u.id === reporter.id) throw new ServiceError(400, "INVALID_REQUEST");
  }
  if (battleId) {
    const [b] = await deps.db.select().from(schema.battle).where(eq(schema.battle.id, battleId));
    if (!b || !(await canViewBattle(deps.db, b, reporter))) throw new ServiceError(404, "NOT_FOUND");
  }

  const id = newId();
  // One report per person per thing; reporting again updates the reason.
  await deps.db
    .insert(schema.report)
    .values({ id, reporterId: reporter.id, subjectType, subjectId, battleId, reason })
    .onConflictDoUpdate({ target: [schema.report.reporterId, schema.report.subjectType, schema.report.subjectId], set: { reason, status: "OPEN" } });
  return { id };
}

function requireStaff(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!isStaff(user)) throw new ServiceError(403, "FORBIDDEN");
  return user;
}

export async function listReports(deps: BattleDeps, user: UserRow | null, status: "OPEN" | "ACTIONED" | "DISMISSED" = "OPEN"): Promise<ModerationReportView[]> {
  requireStaff(user);
  const rows = await deps.db.select().from(schema.report).where(eq(schema.report.status, status)).orderBy(desc(schema.report.createdAt)).limit(100);
  if (!rows.length) return [];
  const msgIds = rows.filter((r) => r.subjectType === "CHAT_MESSAGE").map((r) => r.subjectId);
  const battleIds = [...new Set(rows.map((r) => r.battleId).filter((x): x is string => !!x))];
  const [msgs, battles, counts] = await Promise.all([
    msgIds.length ? deps.db.select().from(schema.chatMessage).where(inArray(schema.chatMessage.id, msgIds)) : [],
    battleIds.length ? deps.db.select({ id: schema.battle.id, title: schema.battle.title }).from(schema.battle).where(inArray(schema.battle.id, battleIds)) : [],
    deps.db
      .select({ subjectId: schema.report.subjectId, n: sql<number>`count(*)::int` })
      .from(schema.report)
      .where(eq(schema.report.status, status))
      .groupBy(schema.report.subjectId),
  ]);
  const subjectUsers = rows.map((r) => (r.subjectType === "USER" ? r.subjectId : r.subjectType === "CHAT_MESSAGE" ? msgs.find((m) => m.id === r.subjectId)?.userId : null));
  const users = await usersById(deps.db, [...new Set([...rows.map((r) => r.reporterId), ...subjectUsers.filter((x): x is string => !!x)])]);
  // One entry per subject (the newest report), with how many reports it has.
  const seen = new Set<string>();
  const out: ModerationReportView[] = [];
  rows.forEach((r, i) => {
    const key = `${r.subjectType}:${r.subjectId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const su = subjectUsers[i];
    out.push({
      id: r.id,
      subjectType: r.subjectType as ReportSubject,
      subjectId: r.subjectId,
      reason: r.reason,
      status: r.status,
      reporter: users.get(r.reporterId)!,
      createdAt: r.createdAt.toISOString(),
      context: {
        battleId: r.battleId,
        battleTitle: battles.find((b) => b.id === r.battleId)?.title ?? null,
        text: r.subjectType === "CHAT_MESSAGE" ? (msgs.find((m) => m.id === r.subjectId)?.body ?? null) : null,
        user: su ? (users.get(su) ?? null) : null,
      },
      reportCount: counts.find((c) => c.subjectId === r.subjectId)?.n ?? 1,
    });
  });
  return out;
}

const ResolveSchema = z
  .object({
    action: z.enum(["DISMISS", "HIDE_MESSAGE", "VOID_BATTLE", "SUSPEND_USER"]),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/** Acts on a report and closes every open report about the same thing. */
export async function resolveReport(deps: BattleDeps, user: UserRow | null, reportId: string, body: unknown): Promise<void> {
  const mod = requireStaff(user);
  const parsed = ResolveSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  const { action, note } = parsed.data as { action: ModerationAction; note?: string };
  const [r] = await deps.db.select().from(schema.report).where(eq(schema.report.id, reportId));
  if (!r) throw new ServiceError(404, "NOT_FOUND");

  let target: { type: string; id: string } = { type: r.subjectType, id: r.subjectId };
  if (action === "HIDE_MESSAGE") {
    if (r.subjectType !== "CHAT_MESSAGE") throw new ServiceError(400, "INVALID_ACTION");
    await deps.db.update(schema.chatMessage).set({ hiddenAt: new Date(), hiddenById: mod.id }).where(eq(schema.chatMessage.id, r.subjectId));
  } else if (action === "VOID_BATTLE") {
    if (!r.battleId) throw new ServiceError(400, "INVALID_ACTION");
    await voidBattleAsModerator(deps, mod, r.battleId, note);
    target = { type: "BATTLE", id: r.battleId };
  } else if (action === "SUSPEND_USER") {
    let userId: string | null = r.subjectType === "USER" ? r.subjectId : null;
    if (r.subjectType === "CHAT_MESSAGE") {
      const [m] = await deps.db.select({ userId: schema.chatMessage.userId }).from(schema.chatMessage).where(eq(schema.chatMessage.id, r.subjectId));
      userId = m?.userId ?? null;
    }
    if (!userId) throw new ServiceError(400, "INVALID_ACTION");
    const [target_] = await deps.db.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.id, userId));
    if (target_?.role === "ADMIN" || (target_?.role === "MODERATOR" && mod.role !== "ADMIN")) throw new ServiceError(403, "FORBIDDEN");
    await deps.db.update(schema.user).set({ status: "SUSPENDED" }).where(eq(schema.user.id, userId));
    await deps.db.delete(schema.session).where(eq(schema.session.userId, userId));
    target = { type: "USER", id: userId };
  }

  await deps.db
    .update(schema.report)
    .set({ status: action === "DISMISS" ? "DISMISSED" : "ACTIONED", handledById: mod.id, handledAt: new Date(), action })
    .where(and(eq(schema.report.subjectType, r.subjectType), eq(schema.report.subjectId, r.subjectId), eq(schema.report.status, "OPEN")));
  if (action !== "VOID_BATTLE") {
    await deps.db.insert(schema.moderationAction).values({ id: newId(), moderatorId: mod.id, action, subjectType: target.type, subjectId: target.id, note: note ?? null });
  }
}

/** Moderators can hide a chat message directly from the battle screen. */
export async function hideMessage(deps: BattleDeps, user: UserRow | null, messageId: string): Promise<void> {
  const mod = requireStaff(user);
  const updated = await deps.db.update(schema.chatMessage).set({ hiddenAt: new Date(), hiddenById: mod.id }).where(eq(schema.chatMessage.id, messageId)).returning({ id: schema.chatMessage.id });
  if (!updated.length) throw new ServiceError(404, "NOT_FOUND");
  await deps.db.insert(schema.moderationAction).values({ id: newId(), moderatorId: mod.id, action: "HIDE_MESSAGE", subjectType: "CHAT_MESSAGE", subjectId: messageId });
}
