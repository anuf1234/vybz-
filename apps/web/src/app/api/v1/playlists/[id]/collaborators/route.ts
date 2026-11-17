import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { addCollaborator } from "@/server/library";

/** Owner. Body: { handle }. */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    await addCollaborator(getBattleDeps(), await currentUser(req), id, await readJson(req));
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
