import { NextResponse } from "next/server";
import { ensureAiVerdicts, getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { background, currentUser, playbackCaps, noStore, route } from "@/server/http";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  const deps = getBattleDeps();
  const code = new URL(req.url).searchParams.get("code");
  const view = await getBattleView(deps, await currentUser(req), id, playbackCaps(req), code);
  // Retry a missing AI verdict (e.g. a failed call when voting opened).
  if (view.currentRoundIndex !== null && view.rounds[view.currentRoundIndex]?.status === "VOTING_OPEN" && view.rules.judging.mode !== "CROWD") {
    background(() => ensureAiVerdicts(deps, id));
  }
  return NextResponse.json(view, noStore);
});
