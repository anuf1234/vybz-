import type { ImageResponse } from "next/og";
import { battleCard } from "@/server/share-card";
import { type CardFormat, chartCard, dropCard, plainCard, rankCard, tournamentCard, warCard } from "@/server/share-cards";

const CARDS: Record<string, (id: string, f: CardFormat) => Promise<ImageResponse>> = {
  battle: battleCard,
  war: warCard,
  drop: dropCard,
  chart: chartCard,
  tournament: tournamentCard,
  rank: rankCard,
};

/** Share images: /card/<battle|war|drop|…>/<id>?format=story|wide. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const format: CardFormat = new URL(req.url).searchParams.get("format") === "wide" ? "wide" : "story";
  const make = CARDS[kind];
  const res = make ? await make(id, format) : await plainCard(format);
  res.headers.set("Cache-Control", "public, max-age=60");
  return res;
}
