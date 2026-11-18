import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { adminCreateQuestion, adminTriviaList } from "@/server/trivia";

/** Staff: ?status=DRAFT|APPROVED|REJECTED|RETIRED|FLAGGED&category=&q= */
export const GET = route(async (req) => NextResponse.json(await adminTriviaList(getBattleDeps(), await currentUser(req), new URL(req.url).searchParams), noStore));

/** Staff: write a question. Body: TriviaQuestionInput & { approve? }. */
export const POST = route(async (req) => NextResponse.json(await adminCreateQuestion(getBattleDeps(), await currentUser(req), await readJson(req))), { mutation: true });
