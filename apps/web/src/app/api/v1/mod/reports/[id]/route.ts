import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { resolveReport } from "@/server/moderation";

/** Moderators. Body: { action: DISMISS | HIDE_MESSAGE | VOID_BATTLE | SUSPEND_USER, note? }. */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    await resolveReport(getBattleDeps(), await currentUser(req), id, await readJson(req));
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
