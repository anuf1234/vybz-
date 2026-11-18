import { ONBOARDING_BONUS } from "@vybz/core";
import { type DbHandle, eq, newId, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { DemoJudge } from "../src/server/ai-judge";
import { onboardingState, updateOnboarding } from "../src/server/onboarding";
import { quickBattle } from "../src/server/quick";
import { answerTrivia, startTrivia } from "../src/server/trivia";
import { TEST_DB_URL, freshDb } from "./helpers";

describe.skipIf(!TEST_DB_URL)("onboarding", () => {
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

});
