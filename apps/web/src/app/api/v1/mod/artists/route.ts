import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { pendingArtistProfiles } from "@/server/artists";

export const GET = route(async (req) => NextResponse.json(await pendingArtistProfiles(getBattleDeps(), await currentUser(req)), noStore));
