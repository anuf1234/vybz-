import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { metrics } from "@/server/metrics";

/** Staff: growth numbers (active people, retention, engagement, outbound plays). */
export const GET = route(async (req) => NextResponse.json(await metrics(getBattleDeps(), await currentUser(req)), noStore));
