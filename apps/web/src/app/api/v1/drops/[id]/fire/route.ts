import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { fireRelease } from "@/server/drops";

/** { on: boolean } */
export const POST = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await fireRelease(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req)), noStore),
  { mutation: true },
);
