import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { getWar } from "@/server/wars";

export const GET = route<{ id: string }>(async (req, { params }) => NextResponse.json(await getWar(getBattleDeps(), await currentUser(req), (await params).id), noStore));
void readJson;
