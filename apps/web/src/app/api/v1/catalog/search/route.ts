import type { CatalogSearchResponse } from "@vybz/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceError } from "@/server/battles/service";
import { searchCatalog, viewerContext } from "@/server/catalog";
import { getCatalogDeps } from "@/server/context";
import { playbackCaps, route } from "@/server/http";

const Query = z.object({ q: z.string().trim().min(1).max(100), source: z.enum(["APPLE_MUSIC", "YOUTUBE", "VYBZ_DEMO"]).optional() });

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const parsed = Query.safeParse({ q: url.searchParams.get("q") ?? "", source: url.searchParams.get("source") ?? undefined });
  if (!parsed.success) throw new ServiceError(400, "INVALID_QUERY");
  const deps = getCatalogDeps();
  if (!deps.metadata.length) throw new ServiceError(503, "NO_PROVIDERS_CONFIGURED");
  const source = parsed.data.source;
  if (source && !deps.metadata.some((m) => m.kind === source)) throw new ServiceError(400, "CATALOG_UNAVAILABLE");
  try {
    const items = await searchCatalog(deps, parsed.data.q, viewerContext(deps.storefront, playbackCaps(req)), source);
    const body: CatalogSearchResponse = { items };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    console.error("catalog search failed", err);
    throw new ServiceError(502, "PROVIDER_ERROR");
  }
});
