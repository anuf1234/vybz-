import type { ImageResponse } from "next/og";
import { genreCard, leagueCard, partyCard, triviaCard, warPickCard } from "@/server/more-cards";
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
  league: leagueCard,
  genres: genreCard,
  trivia: triviaCard,
  party: partyCard,
};

/** Share images: /card/<battle|result|war|drop|chart|tournament|rank|league|genres|trivia>/<id>?format=story|wide. */
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
  // My side of a war: /card/war/<id>?pick=A|B.
  const pick = q.get("pick");
  if (kind === "war" && (pick === "A" || pick === "B")) {
    const res = await warPickCard(id, format, pick);
    res.headers.set("Cache-Control", "public, max-age=60");
    return res;
  }
  const make = CARDS[kind];
  const res = make ? await make(id, format) : await plainCard(format);
  res.headers.set("Cache-Control", "public, max-age=60");
  return res;
}
