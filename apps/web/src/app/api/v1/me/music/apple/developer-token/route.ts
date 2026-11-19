import { NextResponse } from "next/server";
import { getMusicDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { appleDeveloperTokenFor } from "@/server/music-plays";

/** Signed-in only: the developer token MusicKit needs to issue this person's Music User Token. */
export const GET = route(async (req) => NextResponse.json(await appleDeveloperTokenFor(getMusicDeps(), await currentUser(req)), noStore));
