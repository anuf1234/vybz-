import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { followArtist, myArtists, unfollowArtist } from "@/server/drops";

export const GET = route(async (req) => NextResponse.json(await myArtists(getBattleDeps(), await currentUser(req)), noStore));
/** Follow: { provider, externalId, name, artworkUrl? } or { releaseId }. */
export const POST = route(async (req) => NextResponse.json(await followArtist(getBattleDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
/** Unfollow: { externalId } or { name }. */
export const DELETE = route(async (req) => NextResponse.json(await unfollowArtist(getBattleDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
