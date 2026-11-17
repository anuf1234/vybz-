import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { addComment } from "@/server/social";

/** Body: { body } */
export const POST = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await addComment(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req)), { status: 201 }),
  { mutation: true },
);
