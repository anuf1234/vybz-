import { NextResponse } from "next/server";
import { viewerContext } from "@/server/catalog";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, playbackCaps, readJson, route } from "@/server/http";
import { listLibrary, saveToLibrary } from "@/server/library";

/** Your saved songs, newest first. */
export const GET = route(async (req) => {
  const deps = getBattleDeps();
  const user = await currentUser(req);
  return NextResponse.json(await listLibrary(deps, user, viewerContext(deps.catalog.storefront, playbackCaps(req), user?.id ?? null)), noStore);
});

/** Save a song. Body: { catalogId } or { trackId }. */
export const POST = route(
  async (req) => NextResponse.json(await saveToLibrary(getBattleDeps(), await currentUser(req), await readJson(req)), { status: 201 }),
  { mutation: true },
);
