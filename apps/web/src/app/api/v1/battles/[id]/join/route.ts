import { NextResponse } from "next/server";
import { getBattleView, joinBattle } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, playbackCaps, readJson, route } from "@/server/http";

/** Multi-entry: take a seat. Body: { code? } for private battles. */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    const { code } = ((await readJson(req)) ?? {}) as { code?: string };
    await joinBattle(deps, user, id, typeof code === "string" ? code : null);
    return NextResponse.json(await getBattleView(deps, user, id, playbackCaps(req)));
  },
  { mutation: true },
);
