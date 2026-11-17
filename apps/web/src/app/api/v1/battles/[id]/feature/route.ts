import { NextResponse } from "next/server";
import { getBattleView, setFeatured } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, playbackCaps, readJson, route } from "@/server/http";

/** Moderators. Body: { featured: boolean }. */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    const { featured } = ((await readJson(req)) ?? {}) as { featured?: unknown };
    await setFeatured(deps, user, id, featured === true);
    return NextResponse.json(await getBattleView(deps, user, id, playbackCaps(req)));
  },
  { mutation: true },
);
