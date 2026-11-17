import { NextResponse } from "next/server";
import { viewerContext } from "@/server/catalog";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, playbackCaps, route } from "@/server/http";
import { deletePost, getPost } from "@/server/social";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const deps = getBattleDeps();
  const user = await currentUser(req);
  return NextResponse.json(await getPost(deps, user, (await params).id, viewerContext(deps.catalog.storefront, playbackCaps(req), user?.id ?? null)), noStore);
});

export const DELETE = route<{ id: string }>(
  async (req, { params }) => {
    await deletePost(getBattleDeps(), await currentUser(req), (await params).id);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
