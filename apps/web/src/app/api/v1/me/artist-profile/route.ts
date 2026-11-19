import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { claimArtistProfile, myArtistProfile } from "@/server/artists";

export const GET = route(async (req) => NextResponse.json(await myArtistProfile(getBattleDeps(), await currentUser(req)), noStore));
/** { name, code, proofUrl, bio?, links? } */
export const POST = route(async (req) => NextResponse.json(await claimArtistProfile(getBattleDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
