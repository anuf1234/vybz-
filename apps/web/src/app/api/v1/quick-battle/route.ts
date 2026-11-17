import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { quickBattle } from "@/server/quick";

/** One tap to a duel. Body: { genre?, decade?, vsBot? }. */
export const POST = route(async (req) => NextResponse.json(await quickBattle(getBattleDeps(), await currentUser(req), await readJson(req))), { mutation: true });
