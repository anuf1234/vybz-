import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { warRankings } from "@/server/wars";

/** Best album/single of the week, month or year. ?kind=ALBUM|SINGLE&period=week|month|year */
export const GET = route(async (req) => NextResponse.json(await warRankings(getBattleDeps(), new URL(req.url).searchParams), { headers: { "Cache-Control": "public, max-age=60" } }));
void currentUser;
void readJson;
void noStore;
