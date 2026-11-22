import type { BattleView, MeView } from "@vybz/core";
import { type DbHandle, and, eq, schema } from "@vybz/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DB_URL, freshDb } from "./helpers";

/** Guests: a friend's code or link works with one tap, and the account can be saved later. */

const BASE = "http://localhost:3000";

describe.skipIf(!TEST_DB_URL)("guest accounts and battle codes", () => {
  type Mod = Record<string, (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>;
  const routes: Record<string, Mod> = {};
  let h: DbHandle;

  beforeAll(async () => {
    h = await freshDb();
    Object.assign(process.env, {
      DATABASE_URL: TEST_DB_URL,
      BETTER_AUTH_SECRET: "guest-test-secret-guest-test-secret-123",
      BETTER_AUTH_URL: BASE,
      VYBZ_DEMO_CATALOG: "true",
      AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
      CRON_SECRET: "cron-secret-cron-secret",
      APPLE_MUSIC_TEAM_ID: "",
      YOUTUBE_API_KEY: "",
    });
    const load = async (key: string, path: string) => (routes[key] = (await import(path)) as Mod);
    await Promise.all([
      load("auth", "../src/app/api/auth/[...all]/route"),
      load("me", "../src/app/api/v1/me/route"),
      load("save", "../src/app/api/v1/me/save-account/route"),
      load("battles", "../src/app/api/v1/battles/route"),
      load("battle", "../src/app/api/v1/battles/[id]/route"),
      load("code", "../src/app/api/v1/battles/code/[code]/route"),
      load("accept", "../src/app/api/v1/battles/[id]/accept/route"),
    ]);
  });

  afterAll(async () => {
    const g = globalThis as { __vybzDb?: { close: () => Promise<void> } };
    await g.__vybzDb?.close();
    await h?.close();
  });

  async function call(mod: string, method: string, path: string, opts: { body?: unknown; cookie?: string; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { origin: BASE, ...(opts.headers ?? {}) };
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const req = new Request(`${BASE}${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
    return routes[mod]![method]!(req, { params: Promise.resolve(opts.params ?? {}) });
  }
  const cookieFrom = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  it("plays a friend's challenge as a guest, then saves the account in place", async () => {
    const alice = cookieFrom(await call("auth", "POST", "/api/auth/sign-up/email", { body: { name: "Alice", email: "alice@example.com", password: "correct-horse-battery", handle: "alice" } }));
    const created = await call("battles", "POST", "/api/v1/battles", { cookie: alice, body: { title: "2000s R&B battle", visibility: "PRIVATE" } });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const mine = (await (await call("battle", "GET", `/api/v1/battles/${id}`, { cookie: alice, params: { id } })).json()) as BattleView;
    expect(mine.joinCode).toMatch(/^[A-Z]{6}$/);

    // One tap: a guest session, no email.
    const g = await call("auth", "POST", "/api/auth/sign-in/anonymous", { body: {} });
    expect(g.status).toBe(200);
    const guest = cookieFrom(g);
    const me = (await (await call("me", "GET", "/api/v1/me", { cookie: guest })).json()) as MeView;
    expect(me).toMatchObject({ guest: true, displayName: "Guest" });
    expect(me.handle).toMatch(/^guest_\d+$/);

    // The code finds the challenge; the guest takes it.
    const found = (await (await call("code", "GET", `/api/v1/battles/code/${mine.joinCode!.toLowerCase()}`, { cookie: guest, params: { code: mine.joinCode!.toLowerCase() } })).json()) as { id: string; code: string };
    expect(found.id).toBe(id);
    const accepted = await call("accept", "POST", `/api/v1/battles/${id}/accept`, { cookie: guest, params: { id }, body: { code: found.code } });
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as BattleView).status).toBe("IN_PROGRESS");

    // Starting their own battles needs a saved account.
    const own = await call("battles", "POST", "/api/v1/battles", { cookie: guest, body: { title: "Mine" } });
    expect(own.status).toBe(403);
    expect(await own.json()).toMatchObject({ error: "GUEST_ACCOUNT" });

    // Save with email and password: same account, same battle.
    const taken = await call("save", "POST", "/api/v1/me/save-account", { cookie: guest, body: { email: "alice@example.com", password: "another-long-password" } });
    expect(taken.status).toBe(409);
    const saved = await call("save", "POST", "/api/v1/me/save-account", { cookie: guest, body: { email: "gwen@example.com", password: "another-long-password", displayName: "Gwen" } });
    expect(saved.status).toBe(200);
    const after = (await (await call("me", "GET", "/api/v1/me", { cookie: guest })).json()) as MeView;
    expect(after).toMatchObject({ id: me.id, guest: false, email: "gwen@example.com", displayName: "Gwen" });
    const signIn = await call("auth", "POST", "/api/auth/sign-in/email", { body: { email: "gwen@example.com", password: "another-long-password" } });
    expect(signIn.status).toBe(200);
    const view = (await (await call("battle", "GET", `/api/v1/battles/${id}`, { cookie: cookieFrom(signIn), params: { id } })).json()) as BattleView;
    expect(view.participants.map((p) => p.user.id)).toContain(me.id);
  });

  it("moves a guest's battles when they sign in to an existing account", async () => {
    const { mergeGuestInto } = await import("../src/server/guests");
    const [carol] = await h.db.insert(schema.user).values({ id: "u_carol", name: "Carol", email: "carol@example.com", handle: "carol", emailVerified: true }).returning();
    const [g2] = await h.db.insert(schema.user).values({ id: "u_g2", name: "Guest", email: "x@guest.vybz.invalid", handle: "guest_2", isAnonymous: true }).returning();
    const [b] = await h.db.select().from(schema.battle).limit(1);
    await h.db.update(schema.battleParticipant).set({ userId: g2!.id }).where(and(eq(schema.battleParticipant.battleId, b!.id), eq(schema.battleParticipant.side, 1)));
    await mergeGuestInto(h.db, g2!.id, carol!.id);
    const parts = await h.db.select().from(schema.battleParticipant).where(eq(schema.battleParticipant.battleId, b!.id));
    expect(parts.some((p) => p.userId === carol!.id)).toBe(true);
    expect((await h.db.select().from(schema.user).where(eq(schema.user.id, g2!.id)))[0]!.status).toBe("DELETED");
  });
});
