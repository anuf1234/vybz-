import { NextResponse } from "next/server";
import { getBattleView, voidBattleAsModerator } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, playbackCaps, readJson, route } from "@/server/http";

/** Moderators. Body: { note? }. */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    const { note } = ((await readJson(req)) ?? {}) as { note?: string };
    await voidBattleAsModerator(deps, user, id, typeof note === "string" ? note.slice(0, 500) : undefined);
    return NextResponse.json(await getBattleView(deps, user, id, playbackCaps(req)));
  },
  { mutation: true },
);
