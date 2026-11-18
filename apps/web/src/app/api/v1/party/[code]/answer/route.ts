import { NextResponse } from "next/server";
import { getPartyDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { partyAnswer } from "@/server/party";

/** { choice } in a question, { catalogId } when picking, { side } when voting. Header x-party-key. */
export const POST = route<{ code: string }>(
  async (req, { params }) => NextResponse.json(await partyAnswer(getPartyDeps(), (await params).code, req.headers.get("x-party-key"), await readJson(req)), noStore),
  { mutation: true },
);
void currentUser;
