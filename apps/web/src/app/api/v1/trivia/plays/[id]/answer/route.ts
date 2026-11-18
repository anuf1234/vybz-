import { NextResponse } from "next/server";
import { getBattleDeps, getTriviaOptions } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { answerTrivia } from "@/server/trivia";

/** Body: { questionId, choice } (choice null to pass). */
export const POST = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await answerTrivia(getBattleDeps(), getTriviaOptions(), await currentUser(req), (await params).id, await readJson(req))),
  { mutation: true },
);
