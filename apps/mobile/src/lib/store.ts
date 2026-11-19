import { type Purchase, fetchProducts, finishTransaction, getAvailablePurchases, initConnection, purchaseErrorListener, purchaseUpdatedListener, requestPurchase } from "expo-iap";

/**
 * The App Store side of VYBZ Pro (StoreKit through expo-iap). The server
 * verifies every purchase with Apple before Pro turns on; we only finish a
 * transaction after it has.
 */

export interface StoreProduct {
  id: string;
  title: string;
  price: string;
}

let connected: Promise<boolean> | null = null;
const connect = () => (connected ??= initConnection().catch(() => ((connected = null), false)));

export const storeAvailable = true;

export async function loadProducts(ids: string[]): Promise<StoreProduct[]> {
  if (!(await connect())) return [];
  const list = ((await fetchProducts({ skus: ids, type: "subs" })) ?? []) as { id: string; title: string; displayPrice: string }[];
  return list.map((p) => ({ id: p.id, title: p.title, price: p.displayPrice }));
}

/**
 * Starts a purchase and resolves with the transaction once StoreKit reports
 * it (or null if cancelled). The caller verifies it with the server, then
 * calls `finish`.
 */
export async function buy(productId: string, appAccountToken: string): Promise<Purchase | null> {
  if (!(await connect())) throw new Error("The App Store isn't available right now.");
  return new Promise<Purchase | null>((resolve, reject) => {
    const ok = purchaseUpdatedListener((p) => {
      if (p.productId !== productId) return;
      cleanup();
      resolve(p);
    });
    const err = purchaseErrorListener((e) => {
      cleanup();
      if (String(e.code).toLowerCase().includes("cancel")) resolve(null);
      else reject(new Error(e.message || "The purchase didn't go through."));
    });
    const cleanup = () => {
      ok.remove();
      err.remove();
    };
    requestPurchase({ type: "subs", request: { apple: { sku: productId, appAccountToken } } }).catch((e: unknown) => {
      cleanup();
      reject(e instanceof Error ? e : new Error("The purchase didn't go through."));
    });
  });
}

export async function finish(p: Purchase): Promise<void> {
  await finishTransaction({ purchase: p, isConsumable: false }).catch(() => undefined);
}

/** Purchases StoreKit still holds for this Apple ID (for Restore). */
export async function ownedSubscriptions(ids: string[]): Promise<Purchase[]> {
  if (!(await connect())) return [];
  const all = await getAvailablePurchases();
  return all.filter((p) => ids.includes(p.productId));
}
