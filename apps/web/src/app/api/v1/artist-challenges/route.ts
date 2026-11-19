import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { challengeArtist } from "@/server/artists";

/** { mine: releaseId, theirs: releaseId } → the war. Verified artists only. */
export const POST = route(async (req) => NextResponse.json(await challengeArtist(getBattleDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
