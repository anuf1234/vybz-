import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { createTournament, listTournaments } from "@/server/tournaments";

export const GET = route(async () => NextResponse.json(await listTournaments(getBattleDeps()), noStore));
/** Staff: { title, description?, catalogIds: [8 or 16, seed order] } */
export const POST = route(async (req) => NextResponse.json(await createTournament(getBattleDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
