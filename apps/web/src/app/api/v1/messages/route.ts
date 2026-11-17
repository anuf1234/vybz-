import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { inbox, openConversation } from "@/server/social";

/** Your conversations, newest first. */
export const GET = route(async (req) => NextResponse.json(await inbox(getBattleDeps(), await currentUser(req)), noStore));

/** Body: { handle }. Returns the conversation with that person, creating it if needed. */
export const POST = route(
  async (req) => {
    const { handle } = ((await readJson(req)) ?? {}) as { handle?: unknown };
    return NextResponse.json(await openConversation(getBattleDeps(), await currentUser(req), typeof handle === "string" ? handle : ""));
  },
  { mutation: true },
);
