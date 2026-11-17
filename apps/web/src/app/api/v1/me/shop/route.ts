import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { buy, equipFrame, shop } from "@/server/shop";

/** What's for sale, what you own, your coins. */
export const GET = route(async (req) => NextResponse.json(await shop(getBattleDeps().db, await currentUser(req)), noStore));

/** Buy something. Body: { item }. */
export const POST = route(
  async (req) => {
    const body = (await readJson(req)) as { item?: unknown } | null;
    return NextResponse.json(await buy(getBattleDeps().db, await currentUser(req), body?.item));
  },
  { mutation: true },
);

/** Wear a frame you own, or none. Body: { frame: key | null }. */
export const PUT = route(
  async (req) => {
    const body = (await readJson(req)) as { frame?: unknown } | null;
    return NextResponse.json(await equipFrame(getBattleDeps().db, await currentUser(req), body?.frame ?? null));
  },
  { mutation: true },
);
