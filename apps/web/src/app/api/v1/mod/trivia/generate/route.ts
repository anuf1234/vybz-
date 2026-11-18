import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";
import { adminGenerateFromCatalog } from "@/server/trivia";

/** Staff: make album art, artist, Guess the song and release-year questions from the catalog. */
export const POST = route(async (req) => NextResponse.json(await adminGenerateFromCatalog(getBattleDeps(), await currentUser(req))), { mutation: true });
