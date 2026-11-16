import { NextResponse } from "next/server";
import { setHeart } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, parseRoundIndex, readJson, route } from "@/server/http";

/** Body: { submissionId, hearted }. */
export const POST = route<{ id: string; index: string }>(
  async (req, { params }) => {
    const { id, index } = await params;
    await setHeart(getBattleDeps(), await currentUser(req), id, parseRoundIndex(index), await readJson(req));
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
