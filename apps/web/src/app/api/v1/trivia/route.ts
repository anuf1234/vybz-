import { NextResponse } from "next/server";
import { getBattleDeps, getTriviaOptions } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { triviaHub } from "@/server/trivia";

/** Trivia home: today's challenge, streak, categories, today's top scores. ?tz= */
export const GET = route(async (req) => NextResponse.json(await triviaHub(getBattleDeps(), getTriviaOptions(), await currentUser(req), new URL(req.url).searchParams.get("tz")), noStore));
