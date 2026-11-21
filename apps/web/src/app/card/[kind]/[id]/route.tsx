import type { ImageResponse } from "next/og";
import { resultCard } from "@/server/result-card";
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

/** Share images: /card/<battle|result|war|drop|…>/<id>?format=story|wide. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const q = new URL(req.url).searchParams;
  const format: CardFormat = q.get("format") === "wide" ? "wide" : "story";
  // A finished battle from one player's side: /card/result/<battle id>?as=<handle>&code=<invite code>.
  if (kind === "result") {
    const res = await resultCard(id, format, { as: q.get("as")?.slice(0, 40) ?? null, code: q.get("code")?.slice(0, 64) ?? null });
    res.headers.set("Cache-Control", "public, max-age=60");
    return res;
  }
  const make = CARDS[kind];
  const res = make ? await make(id, format) : await plainCard(format);
  res.headers.set("Cache-Control", "public, max-age=60");
  return res;
}
