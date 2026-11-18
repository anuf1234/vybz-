import { ONBOARDING_BONUS } from "@vybz/core";
import { type DbHandle, eq, newId, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { DemoJudge } from "../src/server/ai-judge";
import { onboardingState, updateOnboarding } from "../src/server/onboarding";
import { quickBattle } from "../src/server/quick";
import { answerTrivia, startTrivia } from "../src/server/trivia";
import type { TriviaDrafter } from "../src/server/trivia";
import { adminBankHealth, planBatches, runTriviaPipeline, triviaBankHealth } from "../src/server/trivia-pipeline";
import { TEST_DB_URL, freshDb } from "./helpers";

describe("pipeline planning", () => {
  it("spreads drafts over categories and thin genres first", () => {
    const plan = planBatches([{ genre: "gospel", approved: 2 }, { genre: "jazz", approved: 5 }, { genre: "rnb", approved: 20 }], 60);
    expect(plan.reduce((a, b) => a + b.count, 0)).toBe(60);
    expect(plan).toHaveLength(6);
    expect(plan[0]).toEqual({ category: "ARTIST", genre: "gospel", count: 10 });
    expect(new Set(plan.map((p) => p.category))).toEqual(new Set(["ARTIST", "GENRE", "HISTORY"]));
  });
});

describe.skipIf(!TEST_DB_URL)("onboarding and the trivia pipeline", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let newbie: UserRow;
  let mod: UserRow;
  const OPTS = { audioPreviews: false };

  beforeAll(async () => {
    h = await freshDb();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: new DemoJudge() };
    [newbie, mod] = (await h.db
      .insert(schema.user)
      .values([
        { id: "u_new", name: "New", email: "n@x.com", handle: "newbie" },
        { id: "u_mod", name: "Mod", email: "m@x.com", handle: "mod", role: "MODERATOR" },
      ])
      .returning()) as [UserRow, UserRow];
    // The bot account a quick battle against the bot needs.
    await h.db.insert(schema.user).values({ id: newId(), name: "VYBZ Bot", email: "bot@vybz.app", handle: "vybz_bot", isSystem: true }).onConflictDoNothing();
  });
  afterAll(() => h?.close());

  it("walks a new player through genres, a first battle and today's trivia, then pays once", async () => {
    let s = await onboardingState(deps, newbie);
    expect(s).toMatchObject({ active: true, next: "genres", steps: { battle: false, trivia: false }, botAvailable: true });
    await expect(updateOnboarding(deps, newbie, { genres: [] })).rejects.toMatchObject({ code: "INVALID_GENRES" });
    await expect(updateOnboarding(deps, newbie, { genres: ["rnb", "pop", "rock", "jazz"] })).rejects.toMatchObject({ code: "INVALID_GENRES" });
    s = await updateOnboarding(deps, newbie, { genres: ["rnb", "nope", "hiphop"] });
    expect(s).toMatchObject({ genres: ["rnb", "hiphop"], next: "battle" });

    await quickBattle(deps, newbie, { genre: "rnb", vsBot: true });
    s = await onboardingState(deps, newbie);
    expect(s).toMatchObject({ next: "trivia", steps: { battle: true, trivia: false } });

    let v = await startTrivia(deps, OPTS, newbie, { mode: "DAILY" });
    while (v.question) {
      const r = await answerTrivia(deps, OPTS, newbie, v.id, { questionId: v.question.id, choice: 0 });
      v = { ...v, question: r.next };
    }
    s = await onboardingState(deps, newbie);
    expect(s).toMatchObject({ active: false, done: true, next: null, bonus: ONBOARDING_BONUS });
    s = await onboardingState(deps, newbie);
    expect(s.bonus).toBeNull();
    const ledger = await h.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.reason, "ONBOARDING"));
    expect(ledger).toHaveLength(1);
  });

  it("can be skipped", async () => {
    const s = await updateOnboarding(deps, mod, { action: "skip" });
    expect(s).toMatchObject({ active: false, next: null, done: false });
  });

  it("reports bank health and runs weekly, aimed at thin genres", async () => {
    const health = await triviaBankHealth(h.db, OPTS, null);
    expect(health.approved).toBeGreaterThan(100);
    expect(health.daysLeft).toBe(Math.floor(health.fresh / 10));
    expect(health.thinGenres[0]!.approved).toBeLessThanOrEqual(health.thinGenres.at(-1)!.approved);
    await expect(adminBankHealth(deps, OPTS, null, newbie)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const asked: { category: string; genre: string | null }[] = [];
    let n = 0;
    const drafter: TriviaDrafter = {
      draft: async (input) => {
        asked.push({ category: input.category, genre: input.genre });
        return Array.from({ length: input.count }, () => {
          n++;
          return { category: input.category, prompt: `Draft question number ${n}?`, choices: ["A", "B", "C", "D"], answerIndex: 1, explanation: "Because." };
        });
      },
    };
    const first = await runTriviaPipeline(deps, OPTS, drafter, { total: 20 });
    expect(first).toMatchObject({ ran: true, aiDrafts: 20 });
    expect(asked[0]!.genre).toBe(health.thinGenres[0]!.genre);
    // Not due again for a week (the bank isn't low).
    expect((await runTriviaPipeline(deps, OPTS, drafter, { total: 20 })).ran).toBe(false);
    expect((await runTriviaPipeline(deps, OPTS, drafter, { total: 20, now: new Date(Date.now() + 8 * 86_400_000) })).ran).toBe(true);
    const drafts = await h.db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.source, "AI"));
    expect(drafts).toHaveLength(40);
    expect(drafts.every((d) => d.status === "DRAFT")).toBe(true);
    const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.userId, mod.id));
    expect(notes.some((x) => x.type === "TRIVIA_REVIEW" && x.link === "/mod/trivia-review")).toBe(true);
    // Without an AI key it still adds catalog questions and says what's missing.
    const r = await runTriviaPipeline(deps, OPTS, null, { force: true });
    expect(r.note).toContain("ANTHROPIC_API_KEY");
  });
});
