import { NextResponse } from "next/server";
import { getBattleDeps, getMusicDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { musicLinkStatus } from "@/server/music-plays";

/** "Count my plays" status. */
export const GET = route(async (req) => NextResponse.json(await musicLinkStatus(getBattleDeps(), getMusicDeps(), await currentUser(req)), noStore));
