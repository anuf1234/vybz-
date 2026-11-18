import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { createWar, listWars } from "@/server/wars";

/** ?status=OPEN|CLOSED&kind=ALBUM|SINGLE */
export const GET = route(async (req) => NextResponse.json(await listWars(getBattleDeps(), await currentUser(req), new URL(req.url).searchParams), noStore));
/** Start a war: { kind: "ALBUM" | "SINGLE", a, b } (provider refs from album or song search). */
export const POST = route(async (req) => NextResponse.json(await createWar(getBattleDeps(), await currentUser(req), await readJson(req))), { mutation: true });
