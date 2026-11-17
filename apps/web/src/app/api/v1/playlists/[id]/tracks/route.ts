import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { addToPlaylist } from "@/server/library";

/** Owner or collaborator. Body: { catalogId } or { trackId }. Adds to the end. */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    return NextResponse.json(await addToPlaylist(getBattleDeps(), await currentUser(req), id, await readJson(req)), { status: 201 });
  },
  { mutation: true },
);
