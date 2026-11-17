import { type Executor, and, eq, schema } from "@vybz/db";
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Who can see a battle. Public battles: everyone. Private battles: the host,
 * participants, invitees, staff, and anyone holding the invite link (signed-in
 * users who opened it once keep access).
 */

export type BattleRow = typeof schema.battle.$inferSelect;
type UserRow = typeof schema.user.$inferSelect;

export function newInviteCode(): string {
  return randomBytes(9).toString("base64url");
}

export function isStaff(u: UserRow | null): boolean {
  return u?.role === "MODERATOR" || u?.role === "ADMIN";
}

export function codeMatches(row: BattleRow, code: string | null | undefined): boolean {
  if (!code || !row.inviteCode || code.length !== row.inviteCode.length) return false;
  return timingSafeEqual(Buffer.from(code), Buffer.from(row.inviteCode));
}

/**
 * Whether `viewer` may see the battle. A valid invite code grants lasting access
 * to a signed-in viewer (recorded in battle_access).
 */
export async function canViewBattle(db: Executor, row: BattleRow, viewer: UserRow | null, code?: string | null): Promise<boolean> {
  if (row.visibility === "PUBLIC") return true;
  if (isStaff(viewer)) return true;
  if (codeMatches(row, code)) {
    if (viewer) await db.insert(schema.battleAccess).values({ battleId: row.id, userId: viewer.id }).onConflictDoNothing();
    return true;
  }
  if (!viewer) return false;
  if (row.creatorId === viewer.id || row.invitedUserId === viewer.id) return true;
  const [p, inv, acc] = await Promise.all([
    db.select({ id: schema.battleParticipant.id }).from(schema.battleParticipant).where(and(eq(schema.battleParticipant.battleId, row.id), eq(schema.battleParticipant.userId, viewer.id))).limit(1),
    db.select({ b: schema.battleInvite.battleId }).from(schema.battleInvite).where(and(eq(schema.battleInvite.battleId, row.id), eq(schema.battleInvite.userId, viewer.id))).limit(1),
    db.select({ b: schema.battleAccess.battleId }).from(schema.battleAccess).where(and(eq(schema.battleAccess.battleId, row.id), eq(schema.battleAccess.userId, viewer.id))).limit(1),
  ]);
  return p.length > 0 || inv.length > 0 || acc.length > 0;
}
