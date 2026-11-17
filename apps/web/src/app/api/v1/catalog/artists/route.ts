import type { ArtistSearchResponse } from "@vybz/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceError } from "@/server/battles/service";
import { searchArtists, viewerContext } from "@/server/catalog";
import { getCatalogDeps } from "@/server/context";
import { playbackCaps, route } from "@/server/http";

const Query = z.object({ q: z.string().trim().min(1).max(100) });

/** Artists matching a search, for the picker's artist row. */
export const GET = route(async (req) => {
  const parsed = Query.safeParse({ q: new URL(req.url).searchParams.get("q") ?? "" });
  if (!parsed.success) throw new ServiceError(400, "INVALID_QUERY");
  const deps = getCatalogDeps();
  try {
    const body: ArtistSearchResponse = { items: await searchArtists(deps, parsed.data.q, viewerContext(deps.storefront, playbackCaps(req))) };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    console.error("artist search failed", err);
    throw new ServiceError(502, "PROVIDER_ERROR");
  }
});
