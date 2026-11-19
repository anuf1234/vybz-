import { NextResponse } from "next/server";
import { getBattleDeps, getMusicDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { linkAppleMusic, unlinkAppleMusic } from "@/server/music-plays";

/** { userToken }: turn on "Count my plays" with Apple Music. */
export const POST = route(async (req) => NextResponse.json(await linkAppleMusic(getBattleDeps(), getMusicDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
/** Turn it off and forget the token. */
export const DELETE = route(async (req) => NextResponse.json(await unlinkAppleMusic(getBattleDeps(), getMusicDeps(), await currentUser(req)), noStore), { mutation: true });
