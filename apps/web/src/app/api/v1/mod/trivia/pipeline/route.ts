import { NextResponse } from "next/server";
import { getBattleDeps, getTriviaDrafter, getTriviaOptions } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { adminRunPipeline } from "@/server/trivia-pipeline";

/** Staff: run the drafting pipeline now (30 AI drafts plus catalog questions). */
export const POST = route(async (req) => NextResponse.json(await adminRunPipeline(getBattleDeps(), getTriviaOptions(), getTriviaDrafter(), await currentUser(req)), noStore), { mutation: true });
