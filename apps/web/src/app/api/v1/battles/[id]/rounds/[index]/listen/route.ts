import { NextResponse } from "next/server";
import { recordListen } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, parseRoundIndex, readJson, route } from "@/server/http";

export const POST = route<{ id: string; index: string }>(
  async (req, { params }) => {
    const { id, index } = await params;
    return NextResponse.json(await recordListen(getBattleDeps(), await currentUser(req), id, parseRoundIndex(index), await readJson(req)));
  },
  { mutation: true },
);
