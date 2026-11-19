import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { isStaff } from "@/server/battles/access";
import { ServiceError } from "@/server/battles/service";
import { runDailyDrops } from "@/server/drops";

/** Staff: gather today's drops now (once per UTC day). */
export const POST = route(
  async (req) => {
    const user = await currentUser(req);
    if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
    if (!isStaff(user)) throw new ServiceError(403, "FORBIDDEN");
    return NextResponse.json(await runDailyDrops(getBattleDeps(), { force: true }), noStore);
  },
  { mutation: true },
);
