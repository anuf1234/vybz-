import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { react } from "@/server/live";

/** Body: { emoji }. Guests identify with an X-VYBZ-Viewer key. */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const { emoji } = ((await readJson(req)) ?? {}) as { emoji?: unknown };
    await react(getBattleDeps(), await currentUser(req), id, emoji, req.headers.get("x-vybz-viewer"));
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
