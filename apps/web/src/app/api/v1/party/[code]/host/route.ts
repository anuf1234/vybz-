import { NextResponse } from "next/server";
import { getPartyDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { hostAction, hostView } from "@/server/party";

type P = { code: string };
/** The host screen's view. Header x-party-key: the host key. */
export const GET = route<P>(async (req, { params }) => NextResponse.json(await hostView(getPartyDeps(), await currentUser(req), (await params).code, req.headers.get("x-party-key")), noStore));
/** { action: "start", game, rounds } | { action: "next" | "lobby" | "end" } | { action: "kick", playerId } | { action: "settings", title?, genre? } */
export const POST = route<P>(
  async (req, { params }) => NextResponse.json(await hostAction(getPartyDeps(), await currentUser(req), (await params).code, req.headers.get("x-party-key"), await readJson(req)), noStore),
  { mutation: true },
);
