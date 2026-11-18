import { NextResponse } from "next/server";
import { getBattleDeps, getTriviaDrafter } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { adminDraftWithAi } from "@/server/trivia";

/** Staff: { category: GENRE|ARTIST|HISTORY, genre?, count? } → drafts in the review queue. */
export const POST = route(async (req) => NextResponse.json(await adminDraftWithAi(getBattleDeps(), getTriviaDrafter(), await currentUser(req), await readJson(req))), { mutation: true });
