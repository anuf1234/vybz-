import type { Prisma } from "@vybz/db";

/**
 * XP and badges. Every award is idempotent: the ledger row's unique key
 * (user, kind, source) means retries and repeated sweeps never double-count.
 */

export const XP = {
  VOTE: 2,
  BATTLE_COMPLETED: 25,
  BATTLE_WON: 50,
  CROWD_FAVORITE: 15,
} as const;
export type XPKind = keyof typeof XP;

export const BADGES = [
  { code: "FIRST_BATTLE", name: "First Battle", description: "Finished your first battle.", icon: "🎧" },
  { code: "FIRST_WIN", name: "First Win", description: "Won a battle.", icon: "🏆" },
  { code: "CROWD_FAVORITE", name: "Crowd Favorite", description: "Picked the most-voted track of a battle.", icon: "🔥" },
  { code: "TASTEMAKER", name: "Tastemaker", description: "Voted in 25 rounds.", icon: "🗳️" },
  { code: "OPEN_DOOR", name: "Open Door", description: "Took on an open challenge.", icon: "🚪" },
] as const;
export type BadgeCode = (typeof BADGES)[number]["code"];

export async function awardXP(tx: Prisma.TransactionClient, userId: string, kind: XPKind, sourceId: string): Promise<boolean> {
  const { count } = await tx.xPEvent.createMany({
    data: [{ userId, kind, amount: XP[kind], sourceId }],
    skipDuplicates: true,
  });
  if (count === 0) return false;
  await tx.profile.updateMany({ where: { userId }, data: { xp: { increment: XP[kind] } } });
  return true;
}

/** Grants a badge once, with a notification. Returns whether it was new. */
export async function grantBadge(
  tx: Prisma.TransactionClient,
  userId: string,
  code: BadgeCode,
  sourceId: string | null,
): Promise<boolean> {
  const badge = await tx.badge.findUnique({ where: { code }, select: { id: true, name: true } });
  if (!badge) return false; // not seeded yet
  const { count } = await tx.userBadge.createMany({ data: [{ userId, badgeId: badge.id, sourceId }], skipDuplicates: true });
  if (count === 0) return false;
  await tx.notification.create({ data: { recipientId: userId, type: "BADGE_EARNED", data: { code, name: badge.name } } });
  return true;
}

/** Level from XP: 100 XP for level 2, each level needs 50 more than the last. */
export function levelFor(xp: number): { level: number; into: number; needed: number } {
  let level = 1;
  let need = 100;
  let rest = xp;
  while (rest >= need) {
    rest -= need;
    level++;
    need += 50;
  }
  return { level, into: rest, needed: need };
}
