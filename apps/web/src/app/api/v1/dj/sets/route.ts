import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { createDjSet, myDjSets } from "@/server/dj";

/** Your saved DJ sets (without the move logs). */
export const GET = route(async (req) => NextResponse.json(await myDjSets(getBattleDeps(), await currentUser(req)), noStore));

/** Save a set or battle set: { title, kind, tracks, events, durationMs, stats }. */
export const POST = route(async (req) => NextResponse.json(await createDjSet(getBattleDeps(), await currentUser(req), await readJson(req))), { mutation: true });
