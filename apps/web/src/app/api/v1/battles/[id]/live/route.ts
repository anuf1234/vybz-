import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { liveView } from "@/server/live";

/** Chat, reactions and viewer count. ?after=<messageId> for new messages only. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  const after = new URL(req.url).searchParams.get("after");
  return NextResponse.json(await liveView(getBattleDeps(), await currentUser(req), id, after), noStore);
});
