import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { feedHighlights } from "@/server/highlights";
import { currentUser, route } from "@/server/http";

/** What's happening on VYBZ now: results, live battles, trending votes and featured picks, each labeled community or editorial. */
export const GET = route(async (req) => {
  const items = await feedHighlights(getBattleDeps(), await currentUser(req));
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=30" } });
});
