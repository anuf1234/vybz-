import { generateKeyPairSync } from "node:crypto";
import { type DbHandle, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { djLessonContent, djLessonStep, djUniversity } from "../src/server/dj";
import { resetServerEnv } from "../src/server/env";
import { appAccountToken, appleNotification, claimPurchase, isPro, proStatus } from "../src/server/pro";
import { TEST_DB_URL, freshDb } from "./helpers";

const fakeJws = async (payload: Record<string, unknown>) => new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("not-checked"));

/** A stand-in for Apple's App Store Server API. */
function appleApi(state: { status: number; expires: number; token: string; product?: string; renew?: number }) {
  const calls: string[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    expect(String((init?.headers as Record<string, string>).authorization)).toMatch(/^Bearer ey/);
    // Production says not found; the sandbox (TestFlight) has it.
    if (u.startsWith("https://api.storekit.itunes.apple.com")) return new Response("{}", { status: 404 });
    if (!u.includes("/inApps/v1/subscriptions/1000")) return new Response("{}", { status: 404 });
    const tx = await fakeJws({ transactionId: "1000000002", originalTransactionId: "1000000001", bundleId: "com.urexp.vybz", productId: state.product ?? "com.urexp.vybz.pro.monthly", expiresDate: state.expires, appAccountToken: state.token, environment: "Sandbox" });
    const renewal = await fakeJws({ autoRenewStatus: state.renew ?? 1 });
    return new Response(JSON.stringify({ environment: "Sandbox", bundleId: "com.urexp.vybz", data: [{ lastTransactions: [{ originalTransactionId: "1000000001", status: state.status, signedTransactionInfo: tx, signedRenewalInfo: renewal }] }] }));
  }) as typeof fetch;
  return { f, calls };
}

describe.skipIf(!TEST_DB_URL)("VYBZ Pro", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let ann: UserRow;
  let bo: UserRow;
  let mod: UserRow;

  beforeAll(async () => {
    h = await freshDb();
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    vi.stubEnv("APPLE_IAP_KEY_ID", "KEY123");
    vi.stubEnv("APPLE_IAP_ISSUER_ID", "issuer-uuid");
    vi.stubEnv("APPLE_IAP_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n"));
    resetServerEnv();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    [ann, bo, mod] = (await h.db
      .insert(schema.user)
      .values([
        { id: "u_ann", name: "Ann", email: "a@x.com", handle: "annie" },
        { id: "u_bo", name: "Bo", email: "b@x.com", handle: "bobby" },
        { id: "u_mod", name: "Mod", email: "m@x.com", handle: "mod", role: "MODERATOR" },
      ])
      .returning()) as [UserRow, UserRow, UserRow];
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    resetServerEnv();
    await h?.close();
  });

  it("keeps the first two DJ courses free and the rest for Pro", async () => {
    const uni = await djUniversity(deps, ann);
    expect(uni.pro).toBe(false);
    expect(uni.lessons.map((l) => l.locked)).toEqual(uni.lessons.map((_, i) => i >= 2));
    const free = uni.lessons[1]!;
    const paid = uni.lessons[2]!;
    expect((await djLessonContent(deps, ann, free.id)).quiz.length).toBeGreaterThan(0);
    await expect(djLessonContent(deps, ann, paid.id)).rejects.toMatchObject({ status: 402, code: "PRO_REQUIRED" });
    await expect(djLessonStep(deps, ann, paid.id, { step: "learn" })).rejects.toMatchObject({ code: "PRO_REQUIRED" });
    // Staff always have Pro.
    expect((await djUniversity(deps, mod)).lessons.every((l) => !l.locked)).toBe(true);
  });

  it("turns on only after Apple confirms the purchase for this account", async () => {
    const day = 86_400_000;
    const now = new Date();
    const state = { status: 1, expires: now.getTime() + 30 * day, token: appAccountToken(ann.id) };
    const { f, calls } = appleApi(state);
    await expect(claimPurchase(deps, ann, { transactionId: "abc" }, now, f)).rejects.toMatchObject({ code: "INVALID_PURCHASE" });
    // Bo can't claim Ann's purchase.
    await expect(claimPurchase(deps, bo, { transactionId: "1000000002" }, now, f)).rejects.toMatchObject({ code: "SUBSCRIPTION_IN_USE" });
    const s = await claimPurchase(deps, ann, { transactionId: "1000000002" }, now, f);
    expect(s).toMatchObject({ active: true, source: "APPLE", status: "ACTIVE", willRenew: true });
    expect(calls.some((c) => c.startsWith("https://api.storekit-sandbox.itunes.apple.com/inApps/v1/subscriptions/1000000002"))).toBe(true);
    expect(await isPro(h.db, ann, now)).toBe(true);
    expect((await djUniversity(deps, ann)).lessons.every((l) => !l.locked)).toBe(true);
    // The month's streak freezes, once per paid period.
    await claimPurchase(deps, ann, { transactionId: "1000000002" }, now, f);
    const [p] = await h.db.select().from(schema.userProgress).where(eq(schema.userProgress.userId, ann.id));
    expect(p!.streakFreezes).toBe(2);
  });

  it("rejects other products and follows renewals, cancellations and refunds from Apple", async () => {
    const day = 86_400_000;
    const now = new Date();
    const other = appleApi({ status: 1, expires: now.getTime() + day, token: appAccountToken(ann.id), product: "com.other.app" });
    await expect(claimPurchase(deps, ann, { transactionId: "1000000002" }, now, other.f)).rejects.toMatchObject({ code: "INVALID_PURCHASE" });

    // After the period runs out, a status check asks Apple again: renewed.
    const later = new Date(now.getTime() + 31 * day);
    const renewed = appleApi({ status: 1, expires: later.getTime() + 30 * day, token: appAccountToken(ann.id) });
    const s = await proStatus(deps, ann, later, renewed.f);
    expect(s.active).toBe(true);
    const [p] = await h.db.select().from(schema.userProgress).where(eq(schema.userProgress.userId, ann.id));
    expect(p!.streakFreezes).toBe(4);

    // A refund notification: we re-read Apple, which now says revoked.
    const revoked = appleApi({ status: 5, expires: later.getTime() + 30 * day, token: appAccountToken(ann.id) });
    const signedTransactionInfo = await fakeJws({ originalTransactionId: "1000000001" });
    await appleNotification(deps, { signedPayload: await fakeJws({ notificationType: "REFUND", data: { bundleId: "com.urexp.vybz", signedTransactionInfo } }) }, later, revoked.f);
    expect(await isPro(h.db, ann, later)).toBe(false);
    expect((await proStatus(deps, ann, later)).status).toBe("REVOKED");
  });
});
