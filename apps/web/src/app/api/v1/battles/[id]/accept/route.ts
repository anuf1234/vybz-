import { NextResponse } from "next/server";
import { acceptBattle, getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, playbackCaps, readJson, route } from "@/server/http";

export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    const { code } = ((await readJson(req)) ?? {}) as { code?: string };
    await acceptBattle(deps, user, id, typeof code === "string" ? code : null);
    return NextResponse.json(await getBattleView(deps, user, id, playbackCaps(req)));
  },
  { mutation: true },
);
