import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { rankedBoard } from "@/server/ranked";

/** This season's ranked ladder and your rank. */
export const GET = route(async (req) => NextResponse.json(await rankedBoard(getBattleDeps(), await currentUser(req)), noStore));
