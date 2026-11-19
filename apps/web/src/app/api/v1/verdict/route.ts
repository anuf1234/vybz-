import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { judgePair, nextPair } from "@/server/verdict";

/** This or That: the next pair of drops to pick between. */
export const GET = route(async (req) => NextResponse.json({ pair: await nextPair(getBattleDeps(), await currentUser(req)) }, noStore));
/** { a, b, winner } → { next } */
export const POST = route(async (req) => NextResponse.json(await judgePair(getBattleDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
