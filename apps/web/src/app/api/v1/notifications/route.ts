import { NextResponse } from "next/server";
import { ServiceError } from "@/server/battles/service";
import { getDb } from "@/server/db";
import { currentUser, noStore, route } from "@/server/http";
import { listNotifications } from "@/server/notifications";

export const GET = route(async (req) => {
  const user = await currentUser(req);
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  return NextResponse.json(await listNotifications(getDb(), user.id), noStore);
});
