import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";
import { removeCollaborator } from "@/server/library";

/** The owner removes a collaborator, or a collaborator leaves. */
export const DELETE = route<{ id: string; userId: string }>(
  async (req, { params }) => {
    const { id, userId } = await params;
    await removeCollaborator(getBattleDeps(), await currentUser(req), id, userId);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
