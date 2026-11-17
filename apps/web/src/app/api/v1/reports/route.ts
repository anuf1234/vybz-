import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { fileReport } from "@/server/moderation";

/** Report a chat message, battle or user. */
export const POST = route(
  async (req) => NextResponse.json(await fileReport(getBattleDeps(), await currentUser(req), await readJson(req)), { status: 201 }),
  { mutation: true },
);
