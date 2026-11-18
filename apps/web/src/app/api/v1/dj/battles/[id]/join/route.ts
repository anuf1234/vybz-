import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { joinDjBattle } from "@/server/dj";

/** Take an open battle with one of your battle sets: { setId }. */
export const POST = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await joinDjBattle(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req))),
  { mutation: true },
);
