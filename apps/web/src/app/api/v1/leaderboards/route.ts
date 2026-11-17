import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";
import { leaderboard, parseLeaderboardQuery } from "@/server/leaderboards";

/** ?scope=global|following|genre&genre=rnb&period=week|month|all&metric=wins|rounds|xp */
export const GET = route(async (req) => {
  const q = parseLeaderboardQuery(new URL(req.url).searchParams);
  const user = await currentUser(req);
  return NextResponse.json(await leaderboard(getBattleDeps(), user, q), { headers: { "Cache-Control": user ? "private, max-age=30" : "public, max-age=60" } });
});
