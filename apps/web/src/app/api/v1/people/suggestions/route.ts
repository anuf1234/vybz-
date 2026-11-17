import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { peopleSuggestions } from "@/server/social";

/** People to follow. */
export const GET = route(async (req) => NextResponse.json(await peopleSuggestions(getBattleDeps(), await currentUser(req)), noStore));
