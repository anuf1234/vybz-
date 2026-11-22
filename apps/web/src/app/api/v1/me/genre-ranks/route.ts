import { NextResponse } from "next/server";
import { ServiceError } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { genreRanks } from "@/server/more-cards";

/** Where you rank by wins in each genre this month (genres you've won in), best first. */
export const GET = route(async (req) => {
  const user = await currentUser(req);
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  return NextResponse.json({ items: await genreRanks(getBattleDeps(), user) }, noStore);
});
