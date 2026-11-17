import type { ArtistDetailResponse } from "@vybz/core";
import { NextResponse } from "next/server";
import { ServiceError } from "@/server/battles/service";
import { ARTIST_ID, artistDetail, viewerContext } from "@/server/catalog";
import { getCatalogDeps } from "@/server/context";
import { playbackCaps, route } from "@/server/http";

/** An artist and their songs, most popular first. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  const artistId = decodeURIComponent(id);
  if (!ARTIST_ID.test(artistId)) throw new ServiceError(400, "INVALID_ARTIST_ID");
  const deps = getCatalogDeps();
  let detail: ArtistDetailResponse | null;
  try {
    detail = await artistDetail(deps, artistId, viewerContext(deps.storefront, playbackCaps(req)));
  } catch (err) {
    console.error("artist detail failed", err);
    throw new ServiceError(502, "PROVIDER_ERROR");
  }
  if (!detail) throw new ServiceError(404, "ARTIST_NOT_FOUND");
  return NextResponse.json(detail, { headers: { "Cache-Control": "private, max-age=600" } });
});
