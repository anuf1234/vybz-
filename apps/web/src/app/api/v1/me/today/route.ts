import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { todayFor } from "@/server/drops";

/** ?tz=America/New_York */
export const GET = route(async (req) => NextResponse.json(await todayFor(getBattleDeps(), await currentUser(req), new URL(req.url).searchParams.get("tz")), noStore));
