import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { setChatLike } from "@/server/live";

/** Like or unlike a chat message. Body: { liked: boolean } */
export const POST = route<{ id: string; messageId: string }>(
  async (req, { params }) => {
    const { id, messageId } = await params;
    const { liked } = ((await readJson(req)) ?? {}) as { liked?: unknown };
    return NextResponse.json(await setChatLike(getBattleDeps(), await currentUser(req), id, messageId, liked !== false));
  },
  { mutation: true },
);
