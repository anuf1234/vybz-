import type { RankingsResponse } from "@vybz/core";
import { NextResponse } from "next/server";
import { rankings } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { route } from "@/server/http";

export const GET = route(async () => {
  const body: RankingsResponse = { items: await rankings(getBattleDeps()) };
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=30" } });
});
