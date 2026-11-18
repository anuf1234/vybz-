import { NextResponse } from "next/server";
import { getPartyDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { createParty } from "@/server/party";

/** Host a party: { title?, genre? } → { code, hostKey }. No account needed. */
export const POST = route(async (req) => {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return NextResponse.json(await createParty(getPartyDeps(), await currentUser(req), await readJson(req), ip), noStore);
}, { mutation: true });
