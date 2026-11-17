import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { setLike } from "@/server/social";

/** Body: { liked: boolean } */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { liked } = ((await readJson(req)) ?? {}) as { liked?: unknown };
    await setLike(getBattleDeps(), await currentUser(req), (await params).id, liked !== false);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
