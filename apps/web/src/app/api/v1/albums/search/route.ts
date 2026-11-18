import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { searchAlbums } from "@/server/wars";

/** ?q= */
export const GET = route(async (req) => NextResponse.json({ items: await searchAlbums(getBattleDeps(), new URL(req.url).searchParams.get("q") ?? "") }, { headers: { "Cache-Control": "private, max-age=60" } }));
void currentUser;
void readJson;
void noStore;
