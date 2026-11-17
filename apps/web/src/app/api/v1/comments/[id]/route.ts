import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";
import { deleteComment } from "@/server/social";

export const DELETE = route<{ id: string }>(
  async (req, { params }) => {
    await deleteComment(getBattleDeps(), await currentUser(req), (await params).id);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
