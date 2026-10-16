/**
 * Auth against a real Postgres. Runs when DATABASE_URL is set (CI provides
 * one); skipped otherwise so `pnpm test` works without a database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EmailMessage } from "../src/lib/email";

const DATABASE_URL = process.env.DATABASE_URL;
const BASE = "http://localhost:3000";

describe.skipIf(!DATABASE_URL)("auth (integration)", async () => {
  const { prisma } = await import("@vybz/db");
  const { createAuth } = await import("../src/lib/auth/config");

  const outbox: EmailMessage[] = [];
  const auth = createAuth({
    prisma,
    baseURL: BASE,
    secret: "test-secret-that-is-at-least-32-characters-long",
    sendEmail: async (m) => void outbox.push(m),
    offline: true,
  });

  let ip = 0;
  /** Calls the auth HTTP handler like a browser would. Each call gets a fresh IP unless one is given. */
  async function call(path: string, body?: unknown, opts: { cookie?: string; ip?: string } = {}) {
    const headers = new Headers({ origin: BASE, "x-forwarded-for": opts.ip ?? `10.0.0.${++ip % 250}` });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (opts.cookie) headers.set("cookie", opts.cookie);
    const res = await auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
    const text = await res.text();
    const json = res.headers.get("content-type")?.includes("json") && text ? JSON.parse(text) : null;
    return { status: res.status, json, cookie: cookiesFrom(res) };
  }

  function cookiesFrom(res: Response): string {
    return res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  async function signUpAndVerify(email: string, password = "correct horse battery") {
    await call("/sign-up/email", { email, password, name: "Test User" });
    const link = outbox.findLast((m) => m.to === email)!.text.match(/https?:\/\/\S+/)![0];
    const verify = new URL(link);
    await call(`${verify.pathname.replace("/api/auth", "")}${verify.search}`);
  }

  beforeAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "users", "verifications", "rate_limits" CASCADE');
  });
  beforeEach(() => {
    outbox.length = 0;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("signs up, blocks sign-in until the email is verified, then signs in", async () => {
    const email = "nate@example.com";
    const signUp = await call("/sign-up/email", { email, password: "correct horse battery", name: "Nate" });
    expect(signUp.status).toBe(200);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.subject).toContain("Confirm");

    const early = await call("/sign-in/email", { email, password: "correct horse battery" });
    expect(early.status).toBe(403);

    const link = new URL(outbox[0]!.text.match(/https?:\/\/\S+/)![0]);
    await call(`${link.pathname.replace("/api/auth", "")}${link.search}`);

    const signIn = await call("/sign-in/email", { email, password: "correct horse battery" });
    expect(signIn.status).toBe(200);
    expect(signIn.cookie).toContain("vybz.session_token");

    const session = await call("/get-session", undefined, { cookie: signIn.cookie });
    expect(session.json.user).toMatchObject({ email, emailVerified: true, role: "USER", status: "ACTIVE" });
    expect(session.json.user.trustScore).toBeUndefined();
  });

  it("ignores privileged fields sent at sign-up", async () => {
    const res = await call("/sign-up/email", {
      email: "sneaky@example.com",
      password: "correct horse battery",
      name: "Sneaky",
      role: "ADMIN",
      status: "ACTIVE",
      trustScore: 100,
    });
    // Better Auth either refuses the request or drops server-only fields; never stores them.
    const user = await prisma.user.findUnique({ where: { email: "sneaky@example.com" } });
    if (res.status === 200) expect(user).toMatchObject({ role: "USER", trustScore: 50 });
    else expect(user).toBeNull();
    expect(await prisma.profile.count()).toBe(0);
  });

  it("rejects short passwords", async () => {
    const res = await call("/sign-up/email", { email: "short@example.com", password: "short", name: "S" });
    expect(res.status).toBe(400);
  });

  it("keeps generic profile and email endpoints switched off", async () => {
    await signUpAndVerify("locked@example.com");
    const { cookie } = await call("/sign-in/email", { email: "locked@example.com", password: "correct horse battery" });
    const res = await call("/update-user", { name: "x".repeat(500) }, { cookie });
    expect(res.status).toBe(404);
  });

  it("refuses sessions for banned users", async () => {
    await signUpAndVerify("banned@example.com");
    await prisma.user.update({ where: { email: "banned@example.com" }, data: { status: "BANNED" } });
    const res = await call("/sign-in/email", { email: "banned@example.com", password: "correct horse battery" });
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("ACCOUNT_BANNED");
  });

  it("resets a password and signs out other sessions", async () => {
    const email = "reset@example.com";
    await signUpAndVerify(email);
    const first = await call("/sign-in/email", { email, password: "correct horse battery" });

    await call("/request-password-reset", { email, redirectTo: "/reset-password" });
    const mail = outbox.findLast((m) => m.subject.includes("Reset"))!;
    const token = new URL(mail.text.match(/https?:\/\/\S+/)![0]).pathname.split("/").pop()!;

    const reset = await call("/reset-password", { token, newPassword: "a brand new passphrase" });
    expect(reset.status).toBe(200);

    expect((await call("/get-session", undefined, { cookie: first.cookie })).json).toBeNull();
    expect((await call("/sign-in/email", { email, password: "correct horse battery" })).status).toBe(401);
    expect((await call("/sign-in/email", { email, password: "a brand new passphrase" })).status).toBe(200);
  });

  it("rate-limits repeated sign-in attempts from one IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await call("/sign-in/email", { email: "nobody@example.com", password: "wrong password!" }, { ip: "10.9.9.9" })).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
