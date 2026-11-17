import { NextResponse } from "next/server";
import { viewerContext } from "@/server/catalog";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, playbackCaps, readJson, route } from "@/server/http";
import { deletePlaylist, getPlaylist, updatePlaylist } from "@/server/library";

/** ?code= opens a private playlist from its share link. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  const deps = getBattleDeps();
  const user = await currentUser(req);
  const code = new URL(req.url).searchParams.get("code");
  return NextResponse.json(await getPlaylist(deps, user, id, code, viewerContext(deps.catalog.storefront, playbackCaps(req), user?.id ?? null)), noStore);
});

/** Owner. Body: { title?, description?, visibility? } */
export const PATCH = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const deps = getBattleDeps();
    const user = await currentUser(req);
    await updatePlaylist(deps, user, id, await readJson(req));
    return NextResponse.json(await getPlaylist(deps, user, id, null, viewerContext(deps.catalog.storefront, playbackCaps(req), user?.id ?? null)));
  },
  { mutation: true },
);

export const DELETE = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    await deletePlaylist(getBattleDeps(), await currentUser(req), id);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
