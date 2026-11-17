import { NextResponse } from "next/server";
import { ServiceError } from "@/server/battles/service";
import { viewerContext } from "@/server/catalog";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, playbackCaps, route } from "@/server/http";
import { feed } from "@/server/social";

/** ?kind=following (signed in) | for_you | user&handle=…, ?before=<cursor> */
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const deps = getBattleDeps();
  const user = await currentUser(req);
  const k = sp.get("kind") ?? (user ? "following" : "for_you");
  const kind =
    k === "following" ? ({ kind: "following" } as const) : k === "for_you" ? ({ kind: "for_you" } as const) : k === "user" ? ({ kind: "user", handle: sp.get("handle") ?? "" } as const) : null;
  if (!kind) throw new ServiceError(400, "INVALID_QUERY");
  return NextResponse.json(await feed(deps, user, kind, sp.get("before"), viewerContext(deps.catalog.storefront, playbackCaps(req), user?.id ?? null)), noStore);
});
