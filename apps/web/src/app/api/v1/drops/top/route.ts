import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { topDrops } from "@/server/drop-awards";

/** Song of the Day / Week and Album of the Week: live leaders and past winners. */
export const GET = route(async (req) => NextResponse.json(await topDrops(getBattleDeps(), await currentUser(req)), noStore));
