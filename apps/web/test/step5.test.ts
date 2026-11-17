import { type DbHandle, and, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiJudge } from "../src/server/ai-judge";
import { type BattleDeps, type UserRow, advanceIfDue, ensureAiVerdicts, getBattleView, submitPick } from "../src/server/battles/service";
import { BOT_HANDLE, botJoinDaily, botUser } from "../src/server/bot";
import { ensureDailyBattle } from "../src/server/daily";
import { leaderboard } from "../src/server/leaderboards";
import { BOT_AFTER_MS, botTakeStaleQuick, quickBattle } from "../src/server/quick";
import { TEST_DB_URL, freshDb } from "./helpers";

const MIN = 60_000;
const DEMO_IDS = ["neon-hallway", "midnight-static", "velvet-circuit", "glass-parade", "low-tide-signal", "pulse-garden", "paper-satellites", "afterglow-drive"];

describe.skipIf(!TEST_DB_URL)("step 5", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let noAi: BattleDeps;
  let clock = Date.now();
  const tick = (ms: number) => (clock += ms);
  const u: Record<string, UserRow> = {};
  const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
  // Side A always wins.
  const judge: AiJudge = { label: "Test judge", judge: async () => ({ winner: "A", confidence: 0.7, reason: "A fits the theme better.", model: "test" }) };

  /** A demo song nobody has picked in this battle yet. */
  async function freshSong(battleId: string): Promise<string> {
    const used = await h.db
      .select({ ext: schema.trackProviderRef.externalId })
      .from(schema.submission)
      .innerJoin(schema.trackProviderRef, eq(schema.trackProviderRef.trackId, schema.submission.trackId))
      .where(eq(schema.submission.battleId, battleId));
    const taken = new Set(used.map((r) => r.ext));
    return `VYBZ_DEMO:${DEMO_IDS.find((id) => !taken.has(id))!}`;
  }

  beforeAll(async () => {
    h = await freshDb();
    deps = {
      db: h.db,
      catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" },
      requireVerifiedEmail: false,
      aiJudge: judge,
      now: () => new Date(clock),
    };
    noAi = { ...deps, aiJudge: null };
    for (const handle of ["ann", "bea", "cyd"]) {
      const [row] = await h.db.insert(schema.user).values({ id: `u_${handle}`, name: handle, email: `${handle}@x.com`, handle, emailVerified: true }).returning();
      u[handle] = row!;
    }
  });
  afterAll(() => h?.close());

  describe("quick battle", () => {
    it("opens a battle, then matches the next player into it", async () => {
      const first = await quickBattle(deps, u.ann!, {});
      expect(first.matched).toBe("waiting");
      // Asking again doesn't open a second one.
      expect((await quickBattle(deps, u.ann!, {})).id).toBe(first.id);
      const second = await quickBattle(deps, u.bea!, {});
      expect(second).toEqual({ id: first.id, matched: "player" });
      const v = await getBattleView(deps, u.ann!, first.id);
      expect(v.status).toBe("IN_PROGRESS");
      expect(v.rules.judging.mode).toBe("AI");
      expect(v.title).toBe("Quick battle");
    });

    it("only matches the same theme", async () => {
      const r = await quickBattle(deps, u.ann!, { genre: "rnb", decade: 2000 });
      expect(r.matched).toBe("waiting");
      expect((await quickBattle(deps, u.bea!, { genre: "pop" })).matched).toBe("waiting");
      expect(await quickBattle(deps, u.cyd!, { genre: "rnb", decade: 2000 })).toEqual({ id: r.id, matched: "player" });
    });

    it("hands a battle nobody took to the bot after a couple of minutes", async () => {
      const bea = await h.db.select({ id: schema.battle.id }).from(schema.battle).where(and(eq(schema.battle.creatorId, u.bea!.id), eq(schema.battle.status, "OPEN_CHALLENGE")));
      expect(bea).toHaveLength(1);
      expect(await botTakeStaleQuick(deps)).toBe(0); // too soon
      tick(BOT_AFTER_MS + 1000);
      expect(await botTakeStaleQuick(noAi)).toBe(0); // no AI judge, no bot
      expect(await botTakeStaleQuick(deps)).toBe(1);
      const v = await getBattleView(deps, u.bea!, bea[0]!.id);
      expect(v.status).toBe("IN_PROGRESS");
      expect(v.participants.map((p) => p.user.handle).sort()).toEqual(["bea", BOT_HANDLE]);
    });

    it("refuses the bot without the AI judge", async () => {
      await expect(quickBattle(noAi, u.cyd!, { vsBot: true })).rejects.toMatchObject({ code: "BOT_UNAVAILABLE" });
    });

    it("plays a whole battle against the bot, which earns nothing and stays off the boards", async () => {
      const { id, matched } = await quickBattle(deps, u.cyd!, { vsBot: true });
      expect(matched).toBe("bot");
      const bot = await botUser(deps);
      for (let round = 0; round < 3; round++) {
        let v = await getBattleView(deps, u.cyd!, id);
        if (v.status === "COMPLETE") break;
        // The bot picked as soon as the round opened.
        const botPicks = await h.db
          .select()
          .from(schema.submission)
          .innerJoin(schema.battleParticipant, eq(schema.battleParticipant.id, schema.submission.participantId))
          .where(and(eq(schema.submission.battleId, id), eq(schema.battleParticipant.userId, bot.id)));
        expect(botPicks).toHaveLength(round + 1);
        await submitPick(deps, u.cyd!, id, round, { catalogIds: [await freshSong(id)] });
        v = await getBattleView(deps, u.cyd!, id);
        expect(v.rounds[round]!.status).toBe("VOTING_OPEN");
        expect(await ensureAiVerdicts(deps, id)).toBe(true);
        tick(6 * MIN);
        await advanceIfDue(deps, id);
      }
      const v = await getBattleView(deps, u.cyd!, id);
      expect(v.status).toBe("COMPLETE");

      const ledger = await h.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.reason, "BATTLE"));
      expect(ledger.some((e) => e.userId === u.cyd!.id && e.ref === id)).toBe(true);
      expect(ledger.some((e) => e.userId === bot.id)).toBe(false);
      expect(await h.db.select().from(schema.userAchievement).where(eq(schema.userAchievement.userId, bot.id))).toEqual([]);
      const lb = await leaderboard(deps, null, { scope: "global", period: "all", metric: "wins" });
      expect(lb.items.some((e) => e.user.handle === BOT_HANDLE)).toBe(false);
    });
  });

  describe("daily battle", () => {
    it("the bot enters it once", async () => {
      const id = await ensureDailyBattle(deps);
      expect(await botJoinDaily(deps, id)).toBe(true);
      expect(await botJoinDaily(deps, id)).toBe(false);
      const v = await getBattleView(deps, null, id);
      expect(v.participants.map((p) => p.user.handle)).toEqual([BOT_HANDLE]);
    });
  });
});
