import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { advanceAllDue, ensureAllAiVerdicts } from "@/server/battles/service";
import { getBattleDeps, getMusicDeps } from "@/server/context";
import { botJoinDaily, botPlayAll } from "@/server/bot";
import { ensureDailyBattle } from "@/server/daily";
import { botTakeStaleQuick } from "@/server/quick";
import { closeDueDjBattles } from "@/server/dj";
import { sweepParties } from "@/server/party";
import { closeDueWars } from "@/server/wars";
import { sendStreakReminders } from "@/server/reminders";
import { runDailyDrops, sendDailyDigest } from "@/server/drops";
import { publishWeeklyChart } from "@/server/verdict";
import { advanceTournaments } from "@/server/tournaments";
import { assignLeagues, closeLeagueWeeks } from "@/server/leagues";
import { giveDropAwards } from "@/server/drop-awards";
import { syncPlays } from "@/server/music-plays";
import { snapshotRecent } from "@/server/partner-data";
import { serverEnv } from "@/server/env";

/**
 * Closes rounds whose deadlines have passed. Battles also advance lazily when
 * read, so this only matters for battles nobody is looking at. Schedule it
 * every minute (vercel.json) with `Authorization: Bearer $CRON_SECRET`.
 */
async function handle(req: Request) {
  const secret = serverEnv().CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const deps = getBattleDeps();
  // Verdicts first, so AI-judged rounds closing now can be scored.
  const daily = await ensureDailyBattle(deps).catch((err) => (console.error("daily battle failed", err), null));
  if (daily) await botJoinDaily(deps, daily).catch((err) => console.error("bot daily failed", err));
  const judged = await ensureAllAiVerdicts(deps);
  const advanced = await advanceAllDue(deps);
  // The bot takes quick battles nobody took, then makes any picks it owes.
  const quick = await botTakeStaleQuick(deps).catch((err) => (console.error("bot quick failed", err), 0));
  const botPicks = await botPlayAll(deps).catch((err) => (console.error("bot play failed", err), 0));
  const reminders = await sendStreakReminders(deps.db, deps.push).catch((err) => (console.error("reminders failed", err), 0));
  const djBattles = await closeDueDjBattles(deps).catch((err) => (console.error("dj battles failed", err), 0));
  const parties = await sweepParties(deps).catch((err) => (console.error("party sweep failed", err), 0));
  const wars = await closeDueWars(deps).catch((err) => (console.error("wars failed", err), 0));
  const drops = await runDailyDrops(deps).catch((err) => (console.error("daily drops failed", err), null));
  const digest = await sendDailyDigest(deps.db, deps.push).catch((err) => (console.error("daily digest failed", err), 0));
  const chart = await publishWeeklyChart(deps).catch((err) => (console.error("weekly chart failed", err), null));
  const tournaments = await advanceTournaments(deps).catch((err) => (console.error("tournaments failed", err), 0));
  const plays = await syncPlays(deps, getMusicDeps()).catch((err) => (console.error("play sync failed", err), 0));
  // Partner totals: hourly is plenty (exports refresh today on demand).
  const stats = new Date().getUTCMinutes() >= 5 ? 0 : await snapshotRecent(deps.db).catch((err) => (console.error("stats snapshot failed", err), 0));
  const awards = await giveDropAwards(deps).catch((err) => (console.error("drop awards failed", err), 0));
  // Weekly leagues: close last week (Monday), then put this week's players in groups.
  const leaguesClosed = await closeLeagueWeeks(deps).catch((err) => (console.error("league close failed", err), 0));
  const leaguesJoined = await assignLeagues(deps).catch((err) => (console.error("league assign failed", err), 0));
  return NextResponse.json({ leaguesClosed, leaguesJoined, chart, tournaments, awards, plays, stats, advanced, judged, daily, quick, botPicks, reminders, djBattles, parties, wars, drops: drops?.ran ? drops : null, digest });
}

export { handle as GET, handle as POST };
