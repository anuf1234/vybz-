/**
 * VYBZ Pro: a monthly App Store subscription. Unlocks all of DJ University
 * (the first lessons stay free), a Pro badge and streak freezes each month.
 */

export const PRO = {
  /** App Store product ids (one subscription group). */
  productIds: ["com.urexp.vybz.pro.monthly"],
  /** DJ University lessons anyone can take, by course order. */
  freeLessons: 2,
  /** Streak freezes added each paid month. */
  monthlyFreezes: 2,
} as const;

export type ProSource = "APPLE" | "STAFF";

export interface ProStatus {
  active: boolean;
  source: ProSource | null;
  expiresAt: string | null;
  willRenew: boolean;
  /** "ACTIVE" | "GRACE" | "BILLING_RETRY" | "EXPIRED" | "REVOKED" | null */
  status: string | null;
  /** Products to offer in the app. */
  productIds: string[];
  /** Ties App Store purchases to this VYBZ account (StoreKit appAccountToken). */
  appAccountToken: string;
  /** Purchases can be verified (the server has its App Store key). */
  configured: boolean;
}

/** Lessons sorted by order: the first `freeLessons` are free. */
export function lessonIsFree(order: number, orders: number[]): boolean {
  const sorted = [...orders].sort((a, b) => a - b);
  return sorted.indexOf(order) < PRO.freeLessons;
}
