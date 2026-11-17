import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";
import { blockUser, unblockUser } from "@/server/social";

export const POST = route<{ handle: string }>(
  async (req, { params }) => {
    await blockUser(getBattleDeps(), await currentUser(req), (await params).handle);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);

export const DELETE = route<{ handle: string }>(
  async (req, { params }) => {
    await unblockUser(getBattleDeps(), await currentUser(req), (await params).handle);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
