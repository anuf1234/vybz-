import { type BattleRulesInput, decadeLabel, genreLabel } from "@vybz/core";
import { eq, newId, schema } from "@vybz/db";
import { type BattleDeps, createBattle } from "./battles/service";

/**
 * The daily battle: one open multi-entry battle per UTC day, hosted by a
 * system account, with a rotating genre + era theme. Created by the scheduler.
 */

export const DAILY_HOST_HANDLE = "vybz_daily";

const THEMES: { genre: string; decade: number | null }[] = [
  { genre: "rnb", decade: 1990 },
  { genre: "hiphop", decade: 1990 },
  { genre: "rnb", decade: 2000 },
  { genre: "pop", decade: 2010 },
  { genre: "rock", decade: 1980 },
  { genre: "electronic", decade: null },
  { genre: "funk", decade: 1970 },
  { genre: "hiphop", decade: 2000 },
  { genre: "latin", decade: null },
  { genre: "afrobeats", decade: null },
  { genre: "country", decade: null },
  { genre: "indie", decade: 2000 },
];

export function dailyTheme(date: Date): { genre: string; decade: number | null } {
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
  return THEMES[day % THEMES.length]!;
}

export function dailyRules(theme: { genre: string; decade: number | null }): BattleRulesInput {
  return {
    roundCount: 3,
    entrants: { min: 2, max: 8 },
    creatorPlays: false,
    // Join for 6 hours, then three fast rounds: 3 minutes to pick, 90 seconds to vote.
    challengeExpiryHours: 6,
    timing: { submissionWindowMinutes: 3, votingWindowMinutes: 1.5 },
    constraints: { genres: [theme.genre], ...(theme.decade !== null ? { eraFrom: theme.decade, eraTo: theme.decade + 9 } : {}) },
  };
}

async function dailyHost(deps: BattleDeps) {
  const [existing] = await deps.db.select().from(schema.user).where(eq(schema.user.handle, DAILY_HOST_HANDLE));
  if (existing) return existing;
  const [created] = await deps.db
    .insert(schema.user)
    .values({ id: newId(), name: "VYBZ Daily", handle: DAILY_HOST_HANDLE, email: "daily@system.urexp.com", emailVerified: true, role: "ADMIN", isSystem: true })
    .onConflictDoNothing()
    .returning();
  return created ?? (await deps.db.select().from(schema.user).where(eq(schema.user.handle, DAILY_HOST_HANDLE)))[0]!;
}

/** Creates today's daily battle if it doesn't exist yet. Returns its id. */
export async function ensureDailyBattle(deps: BattleDeps): Promise<string> {
  const t = deps.now?.() ?? new Date();
  const date = t.toISOString().slice(0, 10);
  const [existing] = await deps.db.select({ id: schema.battle.id }).from(schema.battle).where(eq(schema.battle.dailyDate, date));
  if (existing) return existing.id;
  const theme = dailyTheme(t);
  const label = `${theme.decade !== null ? `${decadeLabel(theme.decade)} ` : ""}${genreLabel(theme.genre)}`;
  const host = await dailyHost(deps);
  try {
    const { id } = await createBattle({ ...deps, requireVerifiedEmail: false, aiJudge: deps.aiJudge }, host, { title: `Daily battle: ${label}`, theme: label, rules: dailyRules(theme) }, { dailyDate: date });
    return id;
  } catch (err) {
    // Another scheduler tick created it first.
    const [raced] = await deps.db.select({ id: schema.battle.id }).from(schema.battle).where(eq(schema.battle.dailyDate, date));
    if (raced) return raced.id;
    throw err;
  }
}

