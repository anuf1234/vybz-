import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";
import { removeFromLibrary } from "@/server/library";

export const DELETE = route<{ trackId: string }>(
  async (req, { params }) => {
    const { trackId } = await params;
    await removeFromLibrary(getBattleDeps(), await currentUser(req), trackId);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
