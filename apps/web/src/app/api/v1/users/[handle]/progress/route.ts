import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { noStore, route } from "@/server/http";
import { progressFor } from "@/server/progression";
import { userByHandle } from "@/server/social";

export const GET = route<{ handle: string }>(async (_req, { params }) => {
  const deps = getBattleDeps();
  const user = await userByHandle(deps.db, (await params).handle);
  return NextResponse.json(await progressFor(deps.db, user.id), noStore);
});
