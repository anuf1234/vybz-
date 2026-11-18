import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { adminUpdateQuestion } from "@/server/trivia";

/** Staff: edit a question and/or set its status. */
export const PATCH = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await adminUpdateQuestion(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req))),
  { mutation: true },
);
