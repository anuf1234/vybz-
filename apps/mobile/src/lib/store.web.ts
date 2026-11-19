/** Subscriptions are bought in the iPhone app (App Store). On the web there's no store. */
export interface StoreProduct {
  id: string;
  title: string;
  price: string;
}
type Purchase = { id: string; productId: string };
export const storeAvailable = false;
export async function loadProducts(): Promise<StoreProduct[]> {
  return [];
}
export async function buy(): Promise<Purchase | null> {
  throw new Error("Subscribe in the VYBZ iPhone app.");
}
export async function finish(): Promise<void> {}
export async function ownedSubscriptions(): Promise<Purchase[]> {
  return [];
}
