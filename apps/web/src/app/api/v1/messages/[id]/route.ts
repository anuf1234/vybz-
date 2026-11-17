import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { getConversation, sendMessage } from "@/server/social";

/** The latest messages (oldest first). Opening marks it read. */
export const GET = route<{ id: string }>(async (req, { params }) => NextResponse.json(await getConversation(getBattleDeps(), await currentUser(req), (await params).id), noStore));

/** Body: { body } */
export const POST = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await sendMessage(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req)), { status: 201 }),
  { mutation: true },
);
