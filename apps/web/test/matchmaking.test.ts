import { type DbHandle, eq, schema } from "@vybz/db";
import { MATCHMAKING } from "@vybz/core";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiJudge } from "../src/server/ai-judge";
import { type BattleDeps, type UserRow, battleByCode, createBattle, getBattleView } from "../src/server/battles/service";
import { BOT_AFTER_MS, botTakeStaleQuick, quickBattle } from "../src/server/quick";
import { TEST_DB_URL, freshDb } from "./helpers";

describe.skipIf(!TEST_DB_URL)("smart matchmaking and battle codes", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let clock = Date.now();
  const tick = (ms: number) => (clock += ms);
  const u: Record<string, UserRow> = {};
  const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
  const judge: AiJudge = { label: "Test judge", judge: async () => ({ winner: "A", confidence: 0.7, reason: "Fits.", model: "test" }) };

  beforeAll(async () => {
    h = await freshDb();
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: judge, now: () => new Date(clock) };
    for (const handle of ["dee", "eve", "fay", "gil", "hal"]) {
      const [row] = await h.db.insert(schema.user).values({ id: `u_${handle}`, name: handle, email: `${handle}@x.com`, handle, emailVerified: true }).returning();
      u[handle] = row!;
    }
  });
  afterAll(() => h?.close());

  it("widens a long wait to a new vibe and plays it as the newcomer asked", async () => {
    const waiting = await quickBattle(deps, u.dee!, { genre: "rock", decade: 1990 });
    expect(waiting.matched).toBe("waiting");
    // Too soon: a different genre doesn't match yet.
    expect((await quickBattle(deps, u.eve!, { genre: "rnb", decade: 2000 })).matched).toBe("waiting");
    tick(MATCHMAKING.widenGenreMs + 5_000);
    const r = await quickBattle(deps, u.fay!, { genre: "rnb", decade: 2000, timeZone: "America/Chicago" });
    expect(r.matched).toBe("player");
    // Eve's battle (same vibe as Fay) outranks Dee's widened one.
    const v = await getBattleView(deps, u.fay!, r.id);
    expect(v.participants.map((p) => p.user.handle).sort()).toEqual(["eve", "fay"]);
    const g = await quickBattle(deps, u.gil!, { genre: "jazz", decade: 1960 });
    const dee = await getBattleView(deps, u.gil!, g.id);
    expect(dee.participants.map((p) => p.user.handle).sort()).toEqual(["dee", "gil"]);
    expect(dee).toMatchObject({ title: "Quick battle: 60s Jazz", rules: { constraints: { genres: ["jazz"], eraFrom: 1960, eraTo: 1969 } } });
  });

  it("only lets the bot take battles whose player agreed to it", async () => {
    const no = await quickBattle(deps, u.hal!, { genre: "latin", botFallback: false });
    tick(BOT_AFTER_MS + 60_000);
    expect(await botTakeStaleQuick(deps)).toBe(0);
    expect((await getBattleView(deps, u.hal!, no.id)).status).toBe("OPEN_CHALLENGE");
    const yes = await quickBattle(deps, u.hal!, { genre: "latin" });
    expect(yes.id).toBe(no.id); // same waiting battle, now opted in
    tick(BOT_AFTER_MS + 60_000);
    expect(await botTakeStaleQuick(deps)).toBe(1);
  });

  it("gives private open challenges a code friends can type", async () => {
    const { id } = await createBattle(deps, u.dee!, { title: "Friends only", visibility: "PRIVATE" });
    const [row] = await h.db.select().from(schema.battle).where(eq(schema.battle.id, id));
    expect(row!.joinCode).toMatch(/^[A-HJKMNP-Z]{6}$/);
    const found = await battleByCode(deps, u.eve!.id, `${row!.joinCode!.slice(0, 3).toLowerCase()}-${row!.joinCode!.slice(3)}`);
    expect(found).toMatchObject({ id, code: row!.inviteCode, title: "Friends only" });
    expect((await getBattleView(deps, u.dee!, id)).joinCode).toBe(row!.joinCode);
    expect((await getBattleView(deps, u.eve!, id, undefined, row!.inviteCode)).joinCode).toBeNull();
    await expect(battleByCode(deps, u.eve!.id, "ZZZZZZ")).rejects.toMatchObject({ code: "BATTLE_CODE_NOT_FOUND" });
    // Public challenges don't get one.
    const pub = await createBattle(deps, u.dee!, { title: "Open to all" });
    expect((await h.db.select().from(schema.battle).where(eq(schema.battle.id, pub.id)))[0]!.joinCode).toBeNull();
  });
});
