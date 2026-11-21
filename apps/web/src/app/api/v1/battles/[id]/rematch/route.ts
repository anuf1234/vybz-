import { NextResponse } from "next/server";
import { rematch } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";

/**
 * Run a finished battle back. Players get a rematch; anyone else who opened a
 * shared result passes `against` (the sharer's handle) to challenge them.
 */
export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { against?: unknown; code?: unknown };
    const against = typeof body.against === "string" ? body.against.slice(0, 40) : null;
    const code = typeof body.code === "string" ? body.code.slice(0, 64) : null;
    return NextResponse.json(await rematch(getBattleDeps(), await currentUser(req), id, { against, code }), { status: 201 });
  },
  { mutation: true },
);
