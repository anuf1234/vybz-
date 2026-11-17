import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";
import { postChat } from "@/server/live";

export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const { body } = ((await readJson(req)) ?? {}) as { body?: unknown };
    return NextResponse.json(await postChat(getBattleDeps(), await currentUser(req), id, body), { status: 201 });
  },
  { mutation: true },
);
