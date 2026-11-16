import { NextResponse } from "next/server";
import { getBattleView, submitPick } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, parseRoundIndex, readJson, route } from "@/server/http";

export const POST = route<{ id: string; index: string }>(
  async (req, { params }) => {
    const { id, index } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    const body = (await readJson(req)) as { catalogId?: unknown };
    await submitPick(deps, user, id, parseRoundIndex(index), body?.catalogId);
    return NextResponse.json(await getBattleView(deps, user, id));
  },
  { mutation: true },
);
