import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { listReports } from "@/server/moderation";

/** Moderators: the report queue. ?status=OPEN|ACTIONED|DISMISSED */
export const GET = route(async (req) => {
  const raw = new URL(req.url).searchParams.get("status");
  const status = raw === "ACTIONED" || raw === "DISMISSED" ? raw : "OPEN";
  return NextResponse.json({ items: await listReports(getBattleDeps(), await currentUser(req), status) }, noStore);
});
