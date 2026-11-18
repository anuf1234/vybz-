import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { cancelDjBattle, getDjBattle } from "@/server/dj";

type P = { id: string };
export const GET = route<P>(async (req, { params }) => NextResponse.json(await getDjBattle(getBattleDeps(), await currentUser(req), (await params).id), noStore));
/** Cancel your open battle. */
export const DELETE = route<P>(async (req, { params }) => NextResponse.json(await cancelDjBattle(getBattleDeps(), await currentUser(req), (await params).id)), { mutation: true });
void readJson;
