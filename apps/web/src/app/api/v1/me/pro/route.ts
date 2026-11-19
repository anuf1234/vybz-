import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { proStatus } from "@/server/pro";

/** Your VYBZ Pro status, the products to offer, and your App Store account token. */
export const GET = route(async (req) => NextResponse.json(await proStatus(getBattleDeps(), await currentUser(req)), noStore));
