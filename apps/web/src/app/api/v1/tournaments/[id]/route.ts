import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { getTournament } from "@/server/tournaments";

export const GET = route<{ id: string }>(async (req, { params }) => NextResponse.json(await getTournament(getBattleDeps(), await currentUser(req), (await params).id), noStore));
