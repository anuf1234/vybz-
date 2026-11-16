import { NextResponse } from "next/server";
import { counterBattle, getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, playbackCaps, readJson, route } from "@/server/http";

/** Propose different terms (rounds, tracks per round, genre, era, judging). */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    await counterBattle(deps, user, id, await readJson(req));
    return NextResponse.json(await getBattleView(deps, user, id, playbackCaps(req)));
  },
  { mutation: true },
);
