import { NextResponse } from "next/server";
import { getBattleDeps, getTriviaOptions } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { startTrivia } from "@/server/trivia";

/** Start (or resume) a game. Body: { mode: "DAILY", tz } or { mode: "PRACTICE", category, genre? }. */
export const POST = route(async (req) => NextResponse.json(await startTrivia(getBattleDeps(), getTriviaOptions(), await currentUser(req), await readJson(req))), { mutation: true });
