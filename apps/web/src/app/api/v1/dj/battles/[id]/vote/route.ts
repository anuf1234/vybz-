import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { voteDjBattle } from "@/server/dj";

/** { side: "A" | "B", listenedMs: { A, B } } */
export const POST = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await voteDjBattle(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req))),
  { mutation: true },
);
