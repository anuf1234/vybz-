import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { claimDaily, dailyState } from "@/server/progression";

/** Today's daily reward. ?tz=<IANA zone> so "today" is your day. */
export const GET = route(async (req) =>
  NextResponse.json(await dailyState(getBattleDeps().db, await currentUser(req), new URL(req.url).searchParams.get("tz")), noStore),
);

/** Claim it. Body: { timeZone }. */
export const POST = route(
  async (req) => {
    const deps = getBattleDeps();
    return NextResponse.json(await claimDaily(deps.db, deps.push, await currentUser(req), await readJson(req)));
  },
  { mutation: true },
);
