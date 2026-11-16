import type { CatalogSearchResponse } from "@vybz/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceError } from "@/server/battles/service";
import { guestViewer, searchCatalog } from "@/server/catalog";
import { getCatalogDeps } from "@/server/context";
import { route } from "@/server/http";

const Query = z.object({ q: z.string().trim().min(1).max(100) });

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const parsed = Query.safeParse({ q: url.searchParams.get("q") ?? "" });
  if (!parsed.success) throw new ServiceError(400, "INVALID_QUERY");
  const deps = getCatalogDeps();
  if (!deps.metadata.length) throw new ServiceError(503, "NO_PROVIDERS_CONFIGURED");
  try {
    const items = await searchCatalog(deps, parsed.data.q, guestViewer(deps.storefront));
    const body: CatalogSearchResponse = { items };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    console.error("catalog search failed", err);
    throw new ServiceError(502, "PROVIDER_ERROR");
  }
});
