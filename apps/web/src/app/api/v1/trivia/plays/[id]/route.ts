import { NextResponse } from "next/server";
import { getBattleDeps, getTriviaOptions } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { playView } from "@/server/trivia";

/** The current question (its clock starts on first view), or the result. */
export const GET = route<{ id: string }>(async (req, { params }) =>
  NextResponse.json(await playView(getBattleDeps(), getTriviaOptions(), await currentUser(req), (await params).id), noStore),
);
