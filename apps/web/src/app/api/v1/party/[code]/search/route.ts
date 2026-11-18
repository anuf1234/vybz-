import { NextResponse } from "next/server";
import { getPartyDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { partySearch } from "@/server/party";

/** Song search for the two players picking. ?q= ; header x-party-key. */
export const GET = route<{ code: string }>(async (req, { params }) =>
  NextResponse.json({ items: await partySearch(getPartyDeps(), (await params).code, req.headers.get("x-party-key"), new URL(req.url).searchParams.get("q") ?? "") }, noStore),
);
void currentUser;
void readJson;
