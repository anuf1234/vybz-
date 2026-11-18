import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { advanceAllDue, ensureAllAiVerdicts } from "@/server/battles/service";
import { getBattleDeps, getTriviaDrafter, getTriviaOptions } from "@/server/context";
import { botJoinDaily, botPlayAll } from "@/server/bot";
import { ensureDailyBattle } from "@/server/daily";
import { botTakeStaleQuick } from "@/server/quick";
import { closeDueDjBattles } from "@/server/dj";
import { sweepParties } from "@/server/party";
import { closeDueWars } from "@/server/wars";
import { runTriviaPipeline } from "@/server/trivia-pipeline";
import { sendStreakReminders } from "@/server/reminders";
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
  // Weekly (or daily while the bank is low); a no-op otherwise.
  const trivia = await runTriviaPipeline(deps, getTriviaOptions(), getTriviaDrafter()).catch((err) => (console.error("trivia pipeline failed", err), null));
  return NextResponse.json({ advanced, judged, daily, quick, botPicks, reminders, djBattles, parties, wars, trivia: trivia?.ran ? trivia.note : null });
}

export { handle as GET, handle as POST };
