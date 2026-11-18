import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { adminBulkStatus } from "@/server/trivia";

/** Staff: { ids, status: APPROVED|REJECTED|RETIRED }. */
export const POST = route(async (req) => NextResponse.json(await adminBulkStatus(getBattleDeps(), await currentUser(req), await readJson(req))), { mutation: true });
