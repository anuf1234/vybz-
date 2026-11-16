import { NextResponse } from "next/server";
import { castVote, getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, playbackCaps, parseRoundIndex, readJson, route } from "@/server/http";

export const POST = route<{ id: string; index: string }>(
  async (req, { params }) => {
    const { id, index } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    const body = (await readJson(req)) as { submissionId?: unknown };
    await castVote(deps, user, id, parseRoundIndex(index), body?.submissionId);
    return NextResponse.json(await getBattleView(deps, user, id, playbackCaps(req)));
  },
  { mutation: true },
);
