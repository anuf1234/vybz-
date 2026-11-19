import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { pendingMixtapes } from "@/server/drops";

export const GET = route(async (req) => NextResponse.json(await pendingMixtapes(getBattleDeps(), await currentUser(req)), noStore));
