import { NextResponse } from "next/server";
import { ServiceError } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { leagueView } from "@/server/leagues";

/** Your weekly league: tier, your group's standings, last week's result and your season badges. */
export const GET = route(async (req) => {
  const user = await currentUser(req);
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  return NextResponse.json(await leagueView(getBattleDeps(), user), noStore);
});
