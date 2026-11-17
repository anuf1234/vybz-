import type { BattleView, CatalogSearchResponse } from "@vybz/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DB_URL, freshDb } from "./helpers";

/**
 * Drives the real route handlers (auth + /api/v1) the way the web and mobile
 * clients do, with session cookies, against the test database.
 */

const BASE = "http://localhost:3000";

describe.skipIf(!TEST_DB_URL)("HTTP API", () => {
  type Mod = Record<string, (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>;
  const routes: Record<string, Mod> = {};
  let close: () => Promise<void>;

  beforeAll(async () => {
    const h = await freshDb();
    close = h.close;
    Object.assign(process.env, {
      DATABASE_URL: TEST_DB_URL,
      BETTER_AUTH_SECRET: "api-test-secret-api-test-secret-123456",
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
      load("search", "../src/app/api/v1/catalog/search/route"),
      load("battles", "../src/app/api/v1/battles/route"),
      load("battle", "../src/app/api/v1/battles/[id]/route"),
      load("accept", "../src/app/api/v1/battles/[id]/accept/route"),
      load("submit", "../src/app/api/v1/battles/[id]/rounds/[index]/submit/route"),
      load("listen", "../src/app/api/v1/battles/[id]/rounds/[index]/listen/route"),
      load("vote", "../src/app/api/v1/battles/[id]/rounds/[index]/vote/route"),
      load("rankings", "../src/app/api/v1/rankings/route"),
      load("user", "../src/app/api/v1/users/[handle]/route"),
      load("cron", "../src/app/api/cron/advance/route"),
    ]);
  });

  afterAll(async () => {
    const g = globalThis as { __vybzDb?: { close: () => Promise<void> } };
    await g.__vybzDb?.close();
    await close?.();
  });

  async function call(
    mod: string,
    method: string,
    path: string,
    opts: { body?: unknown; cookie?: string; params?: Record<string, string>; headers?: Record<string, string> } = {},
  ) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const req = new Request(`${BASE}${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
    const handler = routes[mod]![method];
    if (!handler) throw new Error(`${mod} has no ${method}`);
    return handler(req, { params: Promise.resolve(opts.params ?? {}) });
  }

  function cookieFrom(res: Response): string {
    return res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  const cookies: Record<string, string> = {};

  it("signs up on the web and signs in from the mobile app", async () => {
    for (const [name, handle] of [
      ["Alice", "alice_dj"],
      ["Bob", undefined],
    ] as const) {
      const res = await call("auth", "POST", "/api/auth/sign-up/email", {
        body: { name, email: `${name.toLowerCase()}@example.com`, password: "correct-horse-battery", ...(handle ? { handle } : {}) },
        headers: { origin: BASE },
      });
      expect(res.status).toBe(200);
      cookies[name] = cookieFrom(res);
    }

    // The Expo client signs in with its scheme as origin and keeps the cookie itself.
    const mobile = await call("auth", "POST", "/api/auth/sign-in/email", {
      body: { email: "bob@example.com", password: "correct-horse-battery" },
      headers: { "expo-origin": "vybz://" },
    });
    expect(mobile.status).toBe(200);
    cookies.BobMobile = cookieFrom(mobile);
    expect(cookies.BobMobile).toContain("vybz.session_token");

    const bad = await call("auth", "POST", "/api/auth/sign-in/email", {
      body: { email: "bob@example.com", password: "wrong-password-123" },
      headers: { origin: BASE },
    });
    expect(bad.status).toBe(401);
  });

  it("returns the signed-in user and lets them change their handle", async () => {
    const me = await (await call("me", "GET", "/api/v1/me", { cookie: cookies.Alice })).json();
    expect(me).toMatchObject({ handle: "alice_dj", displayName: "Alice", emailVerified: false });
    expect((await call("me", "GET", "/api/v1/me")).status).toBe(401);

    const taken = await call("me", "PATCH", "/api/v1/me", { cookie: cookies.BobMobile, body: { handle: "alice_dj" } });
    expect(taken.status).toBe(409);
    const ok = await call("me", "PATCH", "/api/v1/me", { cookie: cookies.BobMobile, body: { handle: "bobby", displayName: "Bobby B" } });
    expect(await ok.json()).toMatchObject({ handle: "bobby", displayName: "Bobby B" });
  });

  it("searches the demo catalog", async () => {
    const res = await call("search", "GET", "/api/v1/catalog/search?q=demo");
    const body = (await res.json()) as CatalogSearchResponse;
    expect(body.items).toHaveLength(8);
    expect(body.items[0]!.sources[0]).toMatchObject({ tier: "HOSTED_FULL", url: expect.stringContaining("/demo/") });
    expect((await call("search", "GET", "/api/v1/catalog/search?q=")).status).toBe(400);
  });

  let battleId = "";

  it("rejects cross-site mutations and guests", async () => {
    const evil = await call("battles", "POST", "/api/v1/battles", { cookie: cookies.Alice, body: { title: "x" }, headers: { origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    const guest = await call("battles", "POST", "/api/v1/battles", { body: { title: "Guest battle" } });
    expect(guest.status).toBe(401);
  });

  it("runs a battle from the mobile client's point of view", async () => {
    const created = await call("battles", "POST", "/api/v1/battles", {
      cookie: cookies.Alice,
      body: { title: "Late night drive", rules: { roundCount: 3, fairListen: { minPlayedMs: 0 }, voterEligibility: { requireVerifiedEmail: false, minAccountAgeHours: 0 } } },
      headers: { origin: BASE },
    });
    expect(created.status).toBe(201);
    battleId = ((await created.json()) as { id: string }).id;

    const open = await (await call("battles", "GET", "/api/v1/battles?feed=open", { cookie: cookies.BobMobile })).json();
    expect(open.items.map((b: { id: string }) => b.id)).toContain(battleId);

    const params = { id: battleId };
    const accepted = (await (await call("accept", "POST", `/api/v1/battles/${battleId}/accept`, { cookie: cookies.BobMobile, params })).json()) as BattleView;
    expect(accepted.status).toBe("IN_PROGRESS");
    expect(accepted.viewer.action).toBe("submit");

    const p0 = { id: battleId, index: "0" };
    let res = await call("submit", "POST", `/api/v1/battles/${battleId}/rounds/0/submit`, { cookie: cookies.Alice, params: p0, body: { catalogId: "VYBZ_DEMO:afterglow-drive" } });
    expect(res.status).toBe(200);
    res = await call("submit", "POST", `/api/v1/battles/${battleId}/rounds/0/submit`, { cookie: cookies.BobMobile, params: p0, body: { catalogId: "BOGUS" } });
    expect(res.status).toBe(400);
    res = await call("submit", "POST", `/api/v1/battles/${battleId}/rounds/0/submit`, { cookie: cookies.BobMobile, params: p0, body: { catalogId: "VYBZ_DEMO:paper-satellites" } });
    expect(((await res.json()) as BattleView).rounds[0]!.status).toBe("VOTING_OPEN");

    // A guest can see and hear the round but not vote.
    const guestView = (await (await call("battle", "GET", `/api/v1/battles/${battleId}`, { params })).json()) as BattleView;
    expect(guestView.rounds[0]!.entries.map((e) => e.tracks[0]!.playback?.tier)).toEqual(["HOSTED_FULL", "HOSTED_FULL"]);
    expect(guestView.rounds[0]!.viewer.voteBlockedReason).toBe("SIGN_IN_REQUIRED");
    const sub = guestView.rounds[0]!.entries[0]!.submissionId;
    expect((await call("vote", "POST", `/api/v1/battles/${battleId}/rounds/0/vote`, { params: p0, body: { submissionId: sub } })).status).toBe(401);
    expect((await call("listen", "POST", `/api/v1/battles/${battleId}/rounds/0/listen`, { params: p0, body: { submissionId: sub, playedMs: 0, tier: "HOSTED_FULL" } })).status).toBe(401);

    // A third person signs up, listens to both, and votes.
    const carol = await call("auth", "POST", "/api/auth/sign-up/email", {
      body: { name: "Carol", email: "carol@example.com", password: "correct-horse-battery" },
      headers: { "expo-origin": "vybz://" },
    });
    cookies.Carol = cookieFrom(carol);
    for (const e of guestView.rounds[0]!.entries) {
      const l = await call("listen", "POST", `/api/v1/battles/${battleId}/rounds/0/listen`, {
        cookie: cookies.Carol,
        params: p0,
        body: { submissionId: e.submissionId, playedMs: 0, tier: "HOSTED_FULL" },
      });
      expect(l.status).toBe(200);
    }
    const voted = await call("vote", "POST", `/api/v1/battles/${battleId}/rounds/0/vote`, { cookie: cookies.Carol, params: p0, body: { submissionId: sub } });
    expect(voted.status).toBe(200);
    expect(((await voted.json()) as BattleView).rounds[0]!.viewer.votedSubmissionId).toBe(sub);
    const again = await call("vote", "POST", `/api/v1/battles/${battleId}/rounds/0/vote`, { cookie: cookies.Carol, params: p0, body: { submissionId: sub } });
    expect(await again.json()).toMatchObject({ error: "ALREADY_VOTED" });
  });

  it("serves rankings and profiles, and guards the scheduler", async () => {
    expect((await call("rankings", "GET", "/api/v1/rankings")).status).toBe(200);
    const prof = await (await call("user", "GET", "/api/v1/users/alice_dj", { params: { handle: "alice_dj" } })).json();
    expect(prof.recent[0].id).toBe(battleId);
    expect((await call("user", "GET", "/api/v1/users/nobody", { params: { handle: "nobody" } })).status).toBe(404);

    expect((await call("cron", "POST", "/api/cron/advance")).status).toBe(401);
    const ok = await call("cron", "POST", "/api/cron/advance", { headers: { authorization: "Bearer cron-secret-cron-secret" } });
    const { daily } = (await ok.json()) as { daily: string };
    expect(daily).toEqual(expect.any(String));

    // The daily and featured feeds are served as themselves, not the home feed.
    const dailyFeed = await (await call("battles", "GET", "/api/v1/battles?feed=daily")).json();
    expect(dailyFeed.items.map((b: { id: string }) => b.id)).toEqual([daily]);
    const featured = await (await call("battles", "GET", "/api/v1/battles?feed=featured")).json();
    expect(featured.items).toEqual([]);
  });
});
