import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { exportAwards } from "@/server/partner-data";

/** Staff: partner data export. ?format=csv for a spreadsheet. */
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const out = await exportAwards(getBattleDeps(), await currentUser(req), sp);
  if (typeof out === "string") {
    return new NextResponse(out, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="vybz-awards-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
  }
  return NextResponse.json(out, noStore);
});
