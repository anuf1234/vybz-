import { NextResponse } from "next/server";
import { achievementsFor } from "@/server/achievements";
import { getBattleDeps } from "@/server/context";
import { noStore, route } from "@/server/http";
import { userByHandle } from "@/server/social";

export const GET = route<{ handle: string }>(async (_req, { params }) => {
  const deps = getBattleDeps();
  const user = await userByHandle(deps.db, (await params).handle);
  return NextResponse.json(await achievementsFor(deps.db, user.id), noStore);
});
