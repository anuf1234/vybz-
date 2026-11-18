import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { voteWar } from "@/server/wars";

/** { category: "overall" | "songs" | "production" | "lyrics" | "replay" | "t1".."t20", side: "A" | "B" } */
export const POST = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await voteWar(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req))),
  { mutation: true },
);
