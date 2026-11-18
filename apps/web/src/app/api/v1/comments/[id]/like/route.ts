import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { setCommentLike } from "@/server/social";

/** Like or unlike a comment. Body: { liked: boolean } */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { liked } = ((await readJson(req)) ?? {}) as { liked?: unknown };
    return NextResponse.json(await setCommentLike(getBattleDeps(), await currentUser(req), (await params).id, liked !== false));
  },
  { mutation: true },
);
