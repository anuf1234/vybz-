import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { createDjBattle, listDjBattles } from "@/server/dj";

/** ?status=OPEN|VOTING|COMPLETE */
export const GET = route(async (req) => NextResponse.json(await listDjBattles(getBattleDeps(), await currentUser(req), new URL(req.url).searchParams.get("status")), noStore));

/** Start a DJ battle with one of your battle sets: { setId, title? }. */
export const POST = route(async (req) => NextResponse.json(await createDjBattle(getBattleDeps(), await currentUser(req), await readJson(req))), { mutation: true });
