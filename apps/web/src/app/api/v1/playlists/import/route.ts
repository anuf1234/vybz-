import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { importYouTubePlaylist } from "@/server/imports";

/** Import a YouTube playlist. Body: { url }. */
export const POST = route(async (req) => NextResponse.json(await importYouTubePlaylist(getBattleDeps(), await currentUser(req), await readJson(req)), { status: 201 }), {
  mutation: true,
});
