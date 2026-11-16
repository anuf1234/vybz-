import { NextResponse } from "next/server";
import { ensureAiVerdicts, getBattleView, submitPick } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { background, currentUser, parseRoundIndex, readJson, route } from "@/server/http";

export const POST = route<{ id: string; index: string }>(
  async (req, { params }) => {
    const { id, index } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    await submitPick(deps, user, id, parseRoundIndex(index), await readJson(req));
    // If this pick opened voting, the AI judge rules in the background.
    background(() => ensureAiVerdicts(deps, id));
    return NextResponse.json(await getBattleView(deps, user, id));
  },
  { mutation: true },
);
