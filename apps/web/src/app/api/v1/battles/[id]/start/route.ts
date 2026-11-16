import { NextResponse } from "next/server";
import { getBattleView, startBattle } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, playbackCaps, route } from "@/server/http";

export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    await startBattle(deps, user, id);
    return NextResponse.json(await getBattleView(deps, user, id, playbackCaps(req)));
  },
  { mutation: true },
);
