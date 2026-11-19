import { createHash } from "node:crypto";
import { PRO, type ProStatus } from "@vybz/core";
import { type Executor, eq, schema, sql } from "@vybz/db";
import { normalizePrivateKey } from "@vybz/providers";
import { SignJWT, decodeJwt, importPKCS8 } from "jose";
import { isStaff } from "./battles/access";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { serverEnv } from "./env";

/**
 * VYBZ Pro on the App Store. The app buys the subscription with StoreKit,
 * passing this account's appAccountToken, then sends us the transaction id.
 * We never trust what the app says: we ask Apple's App Store Server API for
 * the subscription's status and check the bundle, product and account token.
 * Renewals, cancellations and refunds arrive as App Store Server
 * Notifications; we use them only as a cue to ask Apple again.
 */

const PROD = "https://api.storekit.itunes.apple.com";
const SANDBOX = "https://api.storekit-sandbox.itunes.apple.com";
const STATUS: Record<number, string> = { 1: "ACTIVE", 2: "EXPIRED", 3: "BILLING_RETRY", 4: "GRACE", 5: "REVOKED" };
/** Statuses that keep Pro on (Apple's billing grace period included). */
const ON = new Set(["ACTIVE", "GRACE"]);

type SubRow = typeof schema.subscription.$inferSelect;

export function productIds(): string[] {
  return serverEnv()
    .PRO_PRODUCT_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function iapConfigured(): boolean {
  const env = serverEnv();
  return !!(env.APPLE_IAP_KEY_ID && env.APPLE_IAP_ISSUER_ID && env.APPLE_IAP_PRIVATE_KEY);
}

/** A stable UUID for this account, so a purchase can't be claimed by another VYBZ account. */
export function appAccountToken(userId: string): string {
  const h = createHash("sha256").update(`vybz-pro:${userId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function rowActive(r: SubRow | undefined, now: Date): boolean {
  return !!r && ON.has(r.status) && !!r.expiresAt && r.expiresAt > now;
}

/** Pro for this person right now? Staff always have it (to test and support). */
export async function isPro(db: Executor, user: UserRow | null, now = new Date()): Promise<boolean> {
  if (!user) return false;
  if (isStaff(user)) return true;
  const [r] = await db.select().from(schema.subscription).where(eq(schema.subscription.userId, user.id));
  return rowActive(r, now);
}

async function apiToken(): Promise<string> {
  const env = serverEnv();
  const key = await importPKCS8(normalizePrivateKey(env.APPLE_IAP_PRIVATE_KEY!), "ES256");
  return new SignJWT({ bid: env.APPLE_BUNDLE_ID })
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_IAP_KEY_ID!, typ: "JWT" })
    .setIssuer(env.APPLE_IAP_ISSUER_ID!)
    .setAudience("appstoreconnect-v1")
    .setIssuedAt()
    .setExpirationTime("20m")
    .sign(key);
}

interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  expiresDate?: number;
  revocationDate?: number;
  appAccountToken?: string;
  environment: string;
}

export interface AppleSubscription {
  environment: "Production" | "Sandbox";
  status: string;
  transaction: AppleTransaction;
  willRenew: boolean;
}

/**
 * The subscription a transaction belongs to, straight from Apple (production
 * first, then sandbox for TestFlight). Payloads come over TLS from Apple's
 * own API, so the signed fields are decoded without re-verifying them.
 */
export async function fetchAppleSubscription(transactionId: string, fetchFn: typeof fetch = fetch): Promise<AppleSubscription | null> {
  if (!/^\d{1,30}$/.test(transactionId)) return null;
  const token = await apiToken();
  for (const base of [PROD, SANDBOX]) {
    const res = await fetchFn(`${base}/inApps/v1/subscriptions/${transactionId}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (res.status === 404 || res.status === 400) continue;
    if (!res.ok) throw new Error(`App Store Server API ${res.status}`);
    const json = (await res.json()) as {
      environment: "Production" | "Sandbox";
      bundleId: string;
      data: { lastTransactions: { originalTransactionId: string; status: number; signedTransactionInfo: string; signedRenewalInfo?: string }[] }[];
    };
    const last = json.data.flatMap((g) => g.lastTransactions)[0];
    if (!last) return null;
    const transaction = decodeJwt(last.signedTransactionInfo) as unknown as AppleTransaction;
    const renewal = last.signedRenewalInfo ? (decodeJwt(last.signedRenewalInfo) as { autoRenewStatus?: number }) : {};
    return { environment: json.environment, status: STATUS[last.status] ?? "EXPIRED", transaction, willRenew: renewal.autoRenewStatus === 1 };
  }
  return null;
}

/** Saves what Apple says, and adds the month's streak freezes once per paid period. */
async function save(db: Executor, userId: string, s: AppleSubscription, now: Date): Promise<SubRow> {
  const t = s.transaction;
  const values = {
    userId,
    productId: t.productId,
    originalTransactionId: t.originalTransactionId,
    environment: s.environment,
    status: t.revocationDate ? "REVOKED" : s.status,
    expiresAt: t.expiresDate ? new Date(t.expiresDate) : null,
    willRenew: s.willRenew,
    checkedAt: now,
  };
  const [row] = await db
    .insert(schema.subscription)
    .values(values)
    .onConflictDoUpdate({ target: schema.subscription.userId, set: values })
    .returning();
  if (rowActive(row, now) && (!row!.perksFor || row!.perksFor < row!.expiresAt!)) {
    const [claimed] = await db
      .update(schema.subscription)
      .set({ perksFor: row!.expiresAt })
      .where(sql`${schema.subscription.userId} = ${userId} and (${schema.subscription.perksFor} is null or ${schema.subscription.perksFor} < ${row!.expiresAt})`)
      .returning();
    if (claimed) {
      await db.insert(schema.userProgress).values({ userId }).onConflictDoNothing();
      await db
        .update(schema.userProgress)
        .set({ streakFreezes: sql`${schema.userProgress.streakFreezes} + ${PRO.monthlyFreezes}` })
        .where(eq(schema.userProgress.userId, userId));
    }
  }
  return row!;
}

function view(user: UserRow, r: SubRow | undefined, now: Date): ProStatus {
  const staff = isStaff(user);
  const apple = rowActive(r, now);
  return {
    active: apple || staff,
    source: apple ? "APPLE" : staff ? "STAFF" : null,
    expiresAt: r?.expiresAt?.toISOString() ?? null,
    willRenew: r?.willRenew ?? false,
    status: r?.status ?? null,
    productIds: productIds(),
    appAccountToken: appAccountToken(user.id),
    configured: iapConfigured(),
  };
}

/** Your Pro status. Re-checks with Apple when a paid period has run out (renewals). */
export async function proStatus(deps: BattleDeps, viewer: UserRow | null, now = new Date(), fetchFn?: typeof fetch): Promise<ProStatus> {
  if (!viewer) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  let [r] = await deps.db.select().from(schema.subscription).where(eq(schema.subscription.userId, viewer.id));
  const stale = r && ON.has(r.status) && (!r.expiresAt || r.expiresAt <= now) && now.getTime() - r.checkedAt.getTime() > 10 * 60_000;
  if (stale && iapConfigured()) {
    try {
      const s = await fetchAppleSubscription(r!.originalTransactionId, fetchFn);
      r = s ? await save(deps.db, viewer.id, s, now) : r;
    } catch (err) {
      console.error("pro refresh failed", err);
    }
  }
  return view(viewer, r, now);
}

/** `{ transactionId }` from StoreKit after a purchase or restore. */
export async function claimPurchase(deps: BattleDeps, viewer: UserRow | null, body: unknown, now = new Date(), fetchFn?: typeof fetch): Promise<ProStatus> {
  if (!viewer) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!iapConfigured()) throw new ServiceError(503, "PRO_NOT_CONFIGURED", "Subscriptions aren't set up yet.");
  const id = String((body as { transactionId?: unknown } | null)?.transactionId ?? "");
  const s = await fetchAppleSubscription(id, fetchFn).catch((err) => {
    console.error("pro verify failed", err);
    throw new ServiceError(502, "APPLE_UNAVAILABLE", "Couldn't reach the App Store. Try again in a moment.");
  });
  const t = s?.transaction;
  if (!s || !t || t.bundleId !== serverEnv().APPLE_BUNDLE_ID || !productIds().includes(t.productId)) throw new ServiceError(400, "INVALID_PURCHASE", "That isn't a VYBZ Pro purchase.");
  if (t.appAccountToken && t.appAccountToken.toLowerCase() !== appAccountToken(viewer.id)) {
    throw new ServiceError(409, "SUBSCRIPTION_IN_USE", "This subscription belongs to another VYBZ account.");
  }
  const [other] = await deps.db.select().from(schema.subscription).where(eq(schema.subscription.originalTransactionId, t.originalTransactionId));
  if (other && other.userId !== viewer.id) throw new ServiceError(409, "SUBSCRIPTION_IN_USE", "This subscription belongs to another VYBZ account.");
  const row = await save(deps.db, viewer.id, s, now);
  return view(viewer, row, now);
}

/**
 * App Store Server Notifications V2: `{ signedPayload }`. Only used to find
 * which subscription changed; its status always comes from Apple's API.
 */
export async function appleNotification(deps: BattleDeps, body: unknown, now = new Date(), fetchFn?: typeof fetch): Promise<{ ok: true }> {
  const signed = (body as { signedPayload?: unknown } | null)?.signedPayload;
  if (typeof signed !== "string" || !iapConfigured()) return { ok: true };
  try {
    const payload = decodeJwt(signed) as { data?: { signedTransactionInfo?: string; bundleId?: string } };
    if (!payload.data?.signedTransactionInfo || payload.data.bundleId !== serverEnv().APPLE_BUNDLE_ID) return { ok: true };
    const t = decodeJwt(payload.data.signedTransactionInfo) as unknown as AppleTransaction;
    const [r] = await deps.db.select().from(schema.subscription).where(eq(schema.subscription.originalTransactionId, String(t.originalTransactionId)));
    if (!r) return { ok: true };
    const s = await fetchAppleSubscription(r.originalTransactionId, fetchFn);
    if (s) await save(deps.db, r.userId, s, now);
  } catch (err) {
    console.error("apple notification failed", err);
  }
  return { ok: true };
}
