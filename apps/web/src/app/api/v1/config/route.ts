import { type ConfigResponse, DECADES, GENRES, ROUND_COUNTS, TRACKS_PER_ROUND } from "@vybz/core";
import { NextResponse } from "next/server";
import { getAiJudge } from "@/server/context";
import { route } from "@/server/http";

/** What this server supports, so the apps only offer options that will work. */
export const GET = route(async () => {
  const judge = getAiJudge();
  const body: ConfigResponse = {
    aiJudge: {
      available: Boolean(judge),
      label: judge?.label ?? null,
      note: "The AI judge doesn't hear the audio. It judges each pick from what it knows about the song and how well it fits the theme, without knowing who picked it.",
    },
    genres: GENRES.map((g) => ({ key: g.key, label: g.label })),
    decades: [...DECADES],
    roundCounts: [...ROUND_COUNTS],
    tracksPerRound: [...TRACKS_PER_ROUND],
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
});
