import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { claimPurchase } from "@/server/pro";

/** { transactionId } after a StoreKit purchase or restore. Verified with Apple. */
export const POST = route(async (req) => NextResponse.json(await claimPurchase(getBattleDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
