import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";
import { hideMessage } from "@/server/moderation";

export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    await hideMessage(getBattleDeps(), await currentUser(req), id);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
