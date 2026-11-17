import { NextResponse } from "next/server";
import { ServiceError } from "@/server/battles/service";
import { viewerContext } from "@/server/catalog";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, playbackCaps, readJson, route } from "@/server/http";
import { createPlaylist, listPlaylists } from "@/server/library";
import { eq, schema } from "@vybz/db";

/** ?scope=mine (default, signed in) | public | user&handle=<handle> */
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const deps = getBattleDeps();
  const scope = sp.get("scope") ?? "mine";
  if (scope === "public") return NextResponse.json(await listPlaylists(deps, null, { kind: "public" }), noStore);
  if (scope === "user") {
    const handle = (sp.get("handle") ?? "").toLowerCase();
    const [u] = await deps.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.handle, handle));
    if (!u) throw new ServiceError(404, "NOT_FOUND");
    return NextResponse.json(await listPlaylists(deps, null, { kind: "user", userId: u.id }), noStore);
  }
  if (scope !== "mine") throw new ServiceError(400, "INVALID_QUERY");
  return NextResponse.json(await listPlaylists(deps, await currentUser(req), { kind: "mine" }), noStore);
});

/** Body: { title, description?, visibility?, generate?: { genres, eraFrom?, eraTo?, size? } } */
export const POST = route(
  async (req) => {
    const deps = getBattleDeps();
    const user = await currentUser(req);
    const created = await createPlaylist(deps, user, await readJson(req), viewerContext(deps.catalog.storefront, playbackCaps(req), user?.id ?? null));
    return NextResponse.json(created, { status: 201 });
  },
  { mutation: true },
);
