import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { reorderPlaylist } from "@/server/library";

/** Owner or collaborator. Body: { trackIds } in the new order (all of the playlist's songs). */
export const PUT = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    await reorderPlaylist(getBattleDeps(), await currentUser(req), id, await readJson(req));
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
