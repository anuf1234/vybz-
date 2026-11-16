import { NextResponse } from "next/server";
import { declineBattle, getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";

export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    await declineBattle(deps, user, id);
    return NextResponse.json(await getBattleView(deps, user, id));
  },
  { mutation: true },
);
