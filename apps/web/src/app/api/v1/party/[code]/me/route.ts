import { NextResponse } from "next/server";
import { getPartyDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { playerView } from "@/server/party";

/** A player's view. Header x-party-key: the player key. */
export const GET = route<{ code: string }>(async (req, { params }) => NextResponse.json(await playerView(getPartyDeps(), (await params).code, req.headers.get("x-party-key")), noStore));
void currentUser;
void readJson;
