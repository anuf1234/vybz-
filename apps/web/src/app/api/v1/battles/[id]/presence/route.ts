import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";
import { heartbeat } from "@/server/live";

/** Heartbeat while a battle screen is open (every ~15s). */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    await heartbeat(getBattleDeps(), await currentUser(req), id, req.headers.get("x-vybz-viewer"));
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
