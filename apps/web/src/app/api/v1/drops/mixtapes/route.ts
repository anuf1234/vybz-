import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { submitMixtape } from "@/server/drops";

/** { title, artistName, url, note? } */
export const POST = route(async (req) => NextResponse.json(await submitMixtape(getBattleDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
