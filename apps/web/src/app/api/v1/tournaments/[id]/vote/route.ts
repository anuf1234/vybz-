import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { voteTournament } from "@/server/tournaments";

/** { match, entry } */
export const POST = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await voteTournament(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req)), noStore),
  { mutation: true },
);
