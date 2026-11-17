import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { createPost } from "@/server/social";

/** Body: { body, trackId? | catalogId? | playlistId? | battleId? } */
export const POST = route(async (req) => NextResponse.json(await createPost(getBattleDeps(), await currentUser(req), await readJson(req)), { status: 201 }), { mutation: true });
