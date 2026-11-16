import { NextResponse } from "next/server";
import { getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await getBattleView(getBattleDeps(), await currentUser(req), id), noStore);
});
