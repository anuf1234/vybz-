import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { listDrops } from "@/server/drops";

/** ?range=today|week|following &kind=SINGLE|EP|ALBUM|MIXTAPE &cursor= */
export const GET = route(async (req) => NextResponse.json(await listDrops(getBattleDeps(), await currentUser(req), new URL(req.url).searchParams), noStore));
