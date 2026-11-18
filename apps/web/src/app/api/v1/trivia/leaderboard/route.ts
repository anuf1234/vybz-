import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { triviaLeaderboard } from "@/server/trivia";

/** Daily trivia scores. ?period=today|week|all&scope=global|following&tz= */
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  return NextResponse.json(await triviaLeaderboard(getBattleDeps(), await currentUser(req), { period: sp.get("period") ?? undefined, scope: sp.get("scope") ?? undefined, tz: sp.get("tz") }), noStore);
});
