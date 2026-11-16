import { NextResponse } from "next/server";
import { rematch } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";

export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    return NextResponse.json(await rematch(getBattleDeps(), await currentUser(req), id), { status: 201 });
  },
  { mutation: true },
);
