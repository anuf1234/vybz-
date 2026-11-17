import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { wallet } from "@/server/progression";

/** Your XP, level, coins and how you earned them. ?cursor= for older entries. */
export const GET = route(async (req) =>
  NextResponse.json(await wallet(getBattleDeps().db, await currentUser(req), new URL(req.url).searchParams.get("cursor")), noStore),
);
