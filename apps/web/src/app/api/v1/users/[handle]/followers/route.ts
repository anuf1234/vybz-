import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { followList } from "@/server/social";

export const GET = route<{ handle: string }>(async (req, { params }) =>
  NextResponse.json(await followList(getBattleDeps(), await currentUser(req), (await params).handle, "followers"), noStore),
);
