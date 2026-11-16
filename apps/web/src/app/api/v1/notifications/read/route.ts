import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceError } from "@/server/battles/service";
import { getDb } from "@/server/db";
import { currentUser, readJson, route } from "@/server/http";
import { markRead } from "@/server/notifications";

const Body = z.union([z.object({ all: z.literal(true) }).strict(), z.object({ ids: z.array(z.string().max(40)).min(1).max(100) }).strict()]);

export const POST = route(
  async (req) => {
    const user = await currentUser(req);
    if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST");
    await markRead(getDb(), user.id, "all" in parsed.data ? "all" : parsed.data.ids);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
