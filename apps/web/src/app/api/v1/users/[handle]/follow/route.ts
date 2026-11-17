import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";
import { followUser, unfollowUser } from "@/server/social";

export const POST = route<{ handle: string }>(
  async (req, { params }) => {
    await followUser(getBattleDeps(), await currentUser(req), (await params).handle);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);

export const DELETE = route<{ handle: string }>(
  async (req, { params }) => {
    await unfollowUser(getBattleDeps(), await currentUser(req), (await params).handle);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
