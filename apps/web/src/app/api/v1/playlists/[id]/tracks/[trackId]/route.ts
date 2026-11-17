import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";
import { removeFromPlaylist } from "@/server/library";

export const DELETE = route<{ id: string; trackId: string }>(
  async (req, { params }) => {
    const { id, trackId } = await params;
    await removeFromPlaylist(getBattleDeps(), await currentUser(req), id, trackId);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
