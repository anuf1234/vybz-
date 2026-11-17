import { type BattleAggregate, participantFor } from "@vybz/core";
import { and, eq, inArray, newId, schema } from "@vybz/db";
import { type BattleDeps, ServiceError, type UserRow, joinBattle, submitPick } from "./battles/service";
import { loadBattle } from "./battles/repo";
import { suggestionsFor, viewerContext } from "./catalog";

/**
 * The VYBZ bot: a house player that fills in when nobody else is around. It
 * picks popular songs that fit the battle's theme, never repeats a song in a
 * battle, and is kept off leaderboards and out of rewards (user.is_system).
 */

export const BOT_HANDLE = "vybz_bot";

let botCache: UserRow | null = null;

export async function botUser(deps: BattleDeps): Promise<UserRow> {
  if (botCache) return botCache;
  const [existing] = await deps.db.select().from(schema.user).where(eq(schema.user.handle, BOT_HANDLE));
  if (existing) return (botCache = existing);
  await deps.db
    .insert(schema.user)
    .values({ id: newId(), name: "VYBZ Bot", handle: BOT_HANDLE, email: "bot@system.urexp.com", emailVerified: true, isSystem: true })
    .onConflictDoNothing();
  const [row] = await deps.db.select().from(schema.user).where(eq(schema.user.handle, BOT_HANDLE));
  return (botCache = row!);
}

/** For tests, which recreate the database. */
export function forgetBot(): void {
  botCache = null;
}

/** Rounds where the bot owes picks. */
function roundsOwed(agg: BattleAggregate, botId: string): number[] {
  const me = participantFor(agg, botId);
  if (!me || agg.status !== "IN_PROGRESS") return [];
  return agg.rounds
    .filter((r) => r.status === "SUBMISSIONS_OPEN" && (r.contenderIds === null || r.contenderIds.includes(me.id)))
    .filter((r) => !agg.submissions.some((s) => s.roundId === r.id && s.participantId === me.id))
    .map((r) => r.index);
}

/** Makes the bot's picks in one battle. Returns how many rounds it picked for. */
export async function botPlay(deps: BattleDeps, battleId: string): Promise<number> {
  const bot = await botUser(deps);
  const loaded = await loadBattle(deps.db, battleId);
  if (!loaded) return 0;
  const agg = loaded.aggregate;
  const owed = roundsOwed(agg, bot.id);
  if (!owed.length) return 0;

  const c = agg.rules.constraints ?? {};
  const theme = { genres: c.genres ?? [], ...(c.eraFrom !== undefined ? { eraFrom: c.eraFrom } : {}), ...(c.eraTo !== undefined ? { eraTo: c.eraTo } : {}) };
  const { items } = await suggestionsFor(deps.catalog, theme, viewerContext(deps.catalog.storefront));
  const used = new Set(
    (
      await deps.db
        .select({ catalogId: schema.trackProviderRef.externalId, provider: schema.trackProviderRef.provider })
        .from(schema.submission)
        .innerJoin(schema.trackProviderRef, eq(schema.trackProviderRef.trackId, schema.submission.trackId))
        .where(eq(schema.submission.battleId, battleId))
    ).map((r) => `${r.provider}:${r.catalogId}`),
  );
  // Popular first, with some variety: shuffle within the top 30.
  const pool = items.filter((h) => !used.has(h.catalogId)).slice(0, 30);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }

  const n = agg.rules.tracksPerRound;
  let picked = 0;
  for (const roundIndex of owed) {
    for (let attempt = 0; attempt < 6 && pool.length >= n; attempt++) {
      const set = pool.slice(0, n);
      try {
        await submitPick(deps, bot, battleId, roundIndex, { catalogIds: set.map((h) => h.catalogId) });
        pool.splice(0, n);
        picked++;
        break;
      } catch (err) {
        // Round closed or already picked: stop. A song that doesn't qualify: drop it and try the next.
        if (err instanceof ServiceError && ["ALREADY_SUBMITTED", "ROUND_NOT_ACCEPTING_SUBMISSIONS", "ROUND_NOT_CURRENT", "NOT_A_CONTENDER", "NOT_IN_PROGRESS", "NOT_PARTICIPANT"].includes(err.code)) break;
        console.warn("bot pick rejected", battleId, err instanceof ServiceError ? err.code : err);
        pool.shift();
      }
    }
  }
  return picked;
}

/** Scheduler: picks in every battle the bot is playing. */
export async function botPlayAll(deps: BattleDeps): Promise<number> {
  const bot = await botUser(deps);
  const rows = await deps.db
    .select({ id: schema.battle.id })
    .from(schema.battleParticipant)
    .innerJoin(schema.battle, eq(schema.battle.id, schema.battleParticipant.battleId))
    .where(and(eq(schema.battleParticipant.userId, bot.id), inArray(schema.battle.status, ["IN_PROGRESS"])));
  let n = 0;
  for (const { id } of rows) {
    try {
      n += await botPlay(deps, id);
    } catch (err) {
      console.error("bot play failed", id, err);
    }
  }
  return n;
}

/** The bot enters today's daily battle so it's never empty. */
export async function botJoinDaily(deps: BattleDeps, battleId: string): Promise<boolean> {
  const bot = await botUser(deps);
  const loaded = await loadBattle(deps.db, battleId);
  if (!loaded || loaded.aggregate.status !== "OPEN_CHALLENGE" || participantFor(loaded.aggregate, bot.id)) return false;
  try {
    await joinBattle(deps, bot, battleId);
    return true;
  } catch (err) {
    console.warn("bot couldn't join the daily battle", battleId, err instanceof ServiceError ? err.code : err);
    return false;
  }
}
