import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { trendingAlbums } from "@/server/wars";

/** Albums charting now. */
export const GET = route(async () => NextResponse.json({ items: await trendingAlbums(getBattleDeps()) }, { headers: { "Cache-Control": "public, max-age=600" } }));
void currentUser;
void readJson;
void noStore;
