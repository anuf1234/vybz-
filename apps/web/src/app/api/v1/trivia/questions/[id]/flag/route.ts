import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { flagTriviaQuestion } from "@/server/trivia";

/** Body: { reason }. */
export const POST = route<{ id: string }>(async (req, { params }) => NextResponse.json(await flagTriviaQuestion(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req))), { mutation: true });
