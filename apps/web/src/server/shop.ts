import { MAX_STREAK_FREEZES, SHOP, type ShopResponse, levelForXp, shopItem } from "@vybz/core";
import { type Database, type Executor, eq, newId, schema, sql } from "@vybz/db";
import { ServiceError, type UserRow } from "./battles/service";

/**
 * The coin shop: streak freezes (held, used up automatically when you miss a
 * day) and profile frames (owned for good, one worn at a time). Coins are
 * earned only, never sold, and every purchase is a negative ledger entry.
 */

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  return user;
}

export async function shop(db: Executor, userIn: UserRow | null): Promise<ShopResponse> {
  const user = requireUser(userIn);
  const [[p], owned] = await Promise.all([
    db.select().from(schema.userProgress).where(eq(schema.userProgress.userId, user.id)),
    db.select({ item: schema.userItem.item }).from(schema.userItem).where(eq(schema.userItem.userId, user.id)),
  ]);
  const coins = p?.coins ?? 0;
  const level = levelForXp(p?.xp ?? 0);
  const freezes = p?.streakFreezes ?? 0;
  const have = new Set(owned.map((o) => o.item));
  return {
    coins,
    level,
    streakFreezes: freezes,
    maxStreakFreezes: MAX_STREAK_FREEZES,
    frame: p?.frame ?? null,
    items: SHOP.map((i) => {
      const isOwned = i.kind === "FRAME" && have.has(i.key);
      const blockedReason =
        i.kind === "FRAME" && isOwned
          ? ("OWNED" as const)
          : i.kind === "STREAK_FREEZE" && freezes >= MAX_STREAK_FREEZES
            ? ("MAX_HELD" as const)
            : i.minLevel && level < i.minLevel
              ? ("LEVEL_TOO_LOW" as const)
              : coins < i.price
                ? ("NOT_ENOUGH_COINS" as const)
                : null;
      return { ...i, owned: isOwned, equipped: p?.frame === i.key, blockedReason };
    }),
  };
}

export async function buy(db: Database, userIn: UserRow | null, key: unknown): Promise<ShopResponse> {
  const user = requireUser(userIn);
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  const item = typeof key === "string" ? shopItem(key) : undefined;
  if (!item) throw new ServiceError(404, "NOT_FOUND", "No such item");

  await db.transaction(async (tx) => {
    await tx.insert(schema.userProgress).values({ userId: user.id }).onConflictDoNothing();
    const [p] = await tx.select().from(schema.userProgress).where(eq(schema.userProgress.userId, user.id)).for("update");
    if (item.minLevel && levelForXp(p!.xp) < item.minLevel) throw new ServiceError(409, "LEVEL_TOO_LOW", `Reach level ${item.minLevel} to unlock this.`);
    if (item.kind === "STREAK_FREEZE" && p!.streakFreezes >= MAX_STREAK_FREEZES) throw new ServiceError(409, "MAX_HELD", `You can hold ${MAX_STREAK_FREEZES} streak freezes at a time.`);
    if (item.kind === "FRAME") {
      const [owned] = await tx.insert(schema.userItem).values({ userId: user.id, item: item.key }).onConflictDoNothing().returning();
      if (!owned) throw new ServiceError(409, "OWNED", "You already own this.");
    }
    if (p!.coins < item.price) throw new ServiceError(409, "NOT_ENOUGH_COINS", "Not enough coins yet.");
    await tx.insert(schema.ledgerEntry).values({ id: newId(), userId: user.id, reason: "PURCHASE", ref: `${item.key}:${newId()}`, coins: -item.price });
    await tx
      .update(schema.userProgress)
      .set({
        coins: sql`${schema.userProgress.coins} - ${item.price}`,
        ...(item.kind === "STREAK_FREEZE" ? { streakFreezes: sql`${schema.userProgress.streakFreezes} + 1` } : { frame: item.key }),
      })
      .where(eq(schema.userProgress.userId, user.id));
  });
  return shop(db, user);
}

/** Wear a frame you own, or none (null). */
export async function equipFrame(db: Database, userIn: UserRow | null, key: unknown): Promise<ShopResponse> {
  const user = requireUser(userIn);
  if (key !== null) {
    const item = typeof key === "string" ? shopItem(key) : undefined;
    if (!item || item.kind !== "FRAME") throw new ServiceError(404, "NOT_FOUND", "No such frame");
    const [owned] = await db.select().from(schema.userItem).where(sql`${schema.userItem.userId} = ${user.id} and ${schema.userItem.item} = ${item.key}`);
    if (!owned) throw new ServiceError(403, "NOT_OWNED", "Buy this frame first.");
  }
  await db.insert(schema.userProgress).values({ userId: user.id, frame: key as string | null }).onConflictDoUpdate({ target: schema.userProgress.userId, set: { frame: key as string | null } });
  return shop(db, user);
}
