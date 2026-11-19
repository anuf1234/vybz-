import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { chart } from "@/server/verdict";

/** The VYBZ Chart: ?week=2026-W47 (default this week). */
export const GET = route(async (req) => NextResponse.json(await chart(getBattleDeps(), await currentUser(req), new URL(req.url).searchParams.get("week")), noStore));
