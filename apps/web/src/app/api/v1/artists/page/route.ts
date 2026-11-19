import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { artistPage } from "@/server/artists";

/** ?name=Artist Name */
export const GET = route(async (req) => NextResponse.json(await artistPage(getBattleDeps(), await currentUser(req), new URL(req.url).searchParams.get("name") ?? ""), noStore));
