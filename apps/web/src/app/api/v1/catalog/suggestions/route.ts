import { GENRE_KEYS, type SuggestionsResponse } from "@vybz/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceError } from "@/server/battles/service";
import { suggestionsFor, viewerContext } from "@/server/catalog";
import { getCatalogDeps } from "@/server/context";
import { playbackCaps, route } from "@/server/http";

const Year = z.coerce.number().int().min(1900).max(2100);
const Query = z
  .object({
    genres: z.array(z.enum(GENRE_KEYS)).max(3),
    eraFrom: Year.optional(),
    eraTo: Year.optional(),
  })
  .refine((q) => q.eraFrom === undefined || q.eraTo === undefined || q.eraFrom <= q.eraTo);

/** Songs that fit a battle's genres and era: ?genres=rnb,hiphop&eraFrom=1990&eraTo=1999 */
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const parsed = Query.safeParse({
    genres: (sp.get("genres") ?? "").split(",").map((g) => g.trim()).filter(Boolean),
    eraFrom: sp.get("eraFrom") ?? undefined,
    eraTo: sp.get("eraTo") ?? undefined,
  });
  if (!parsed.success) throw new ServiceError(400, "INVALID_QUERY");
  const { genres, eraFrom, eraTo } = parsed.data;
  const deps = getCatalogDeps();
  try {
    const body: SuggestionsResponse = await suggestionsFor(
      deps,
      { genres, ...(eraFrom !== undefined ? { eraFrom } : {}), ...(eraTo !== undefined ? { eraTo } : {}) },
      viewerContext(deps.storefront, playbackCaps(req)),
    );
    return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (err) {
    console.error("suggestions failed", err);
    throw new ServiceError(502, "PROVIDER_ERROR");
  }
});
