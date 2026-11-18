import { NextResponse } from "next/server";
import { getPartyDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { joinParty } from "@/server/party";

/** { name } → { playerId, playerKey }. Signed-in players earn XP too. */
export const POST = route<{ code: string }>(
  async (req, { params }) => NextResponse.json(await joinParty(getPartyDeps(), await currentUser(req), (await params).code, await readJson(req)), noStore),
  { mutation: true },
);
