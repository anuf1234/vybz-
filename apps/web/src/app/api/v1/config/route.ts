import { type ConfigResponse, DECADES, GENRES, ROUND_COUNTS, TRACKS_PER_ROUND } from "@vybz/core";
import { NextResponse } from "next/server";
import { PROVIDER_LABEL } from "@/server/catalog";
import { getAiJudge, getCatalogDeps } from "@/server/context";
import { serverEnv } from "@/server/env";
import { route } from "@/server/http";

/** What this server supports, so the apps only offer options that will work. */
export const GET = route(async () => {
  const judge = getAiJudge();
  const env = serverEnv();
  const catalog = getCatalogDeps();
  const body: ConfigResponse = {
    catalogs: catalog.metadata.map((m) => ({ provider: m.kind, label: PROVIDER_LABEL[m.kind] })),
    playback: { appleMusic: Boolean(catalog.playback.APPLE_MUSIC), youtube: Boolean(catalog.playback.YOUTUBE) },
    aiJudge: {
      available: Boolean(judge),
      label: judge?.label ?? null,
      note: "The AI judge doesn't hear the audio. It judges each pick from what it knows about the song and how well it fits the theme, without knowing who picked it.",
    },
    genres: GENRES.map((g) => ({ key: g.key, label: g.label })),
    decades: [...DECADES],
    roundCounts: [...ROUND_COUNTS],
    tracksPerRound: [...TRACKS_PER_ROUND],
    giphy: env.GIPHY_API_KEY ? { apiKey: env.GIPHY_API_KEY } : null,
    signIn: {
      google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      facebook: Boolean(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET),
      tiktok: Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
      apple: env.APPLE_SIGN_IN,
    },
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
});
