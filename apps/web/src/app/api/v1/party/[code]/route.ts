import { NextResponse } from "next/server";
import { getPartyDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { partyInfo } from "@/server/party";

type P = { code: string };
/** Whether a code is a live party (for the join screen). */
export const GET = route<P>(async (_req, { params }) => NextResponse.json(await partyInfo(getPartyDeps(), (await params).code), noStore));
void currentUser;
void readJson;
