import { NextResponse } from "next/server";
import { profile } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";

export const GET = route<{ handle: string }>(async (req, { params }) => {
  const { handle } = await params;
  return NextResponse.json(await profile(getBattleDeps(), await currentUser(req), handle), noStore);
});
