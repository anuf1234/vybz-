import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { searchArtists } from "@/server/drops";

export const GET = route(async (req) => NextResponse.json(await searchArtists(getBattleDeps(), await currentUser(req), new URL(req.url).searchParams.get("q") ?? ""), noStore));
