import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceError } from "@/server/battles/service";
import { getDb } from "@/server/db";
import { currentUser, readJson, route } from "@/server/http";
import { removePushToken, savePushToken } from "@/server/notifications";

const Body = z.object({ token: z.string().regex(/^(Exponent|Expo)PushToken\[[^\]]{10,200}\]$/), platform: z.enum(["ios", "android", "web"]).default("ios") }).strict();

/** Register this device for phone notifications. */
export const POST = route(
  async (req) => {
    const user = await currentUser(req);
    if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST");
    await savePushToken(getDb(), user.id, parsed.data.token, parsed.data.platform);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);

export const DELETE = route(
  async (req) => {
    const user = await currentUser(req);
    if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
    const { token } = ((await readJson(req)) ?? {}) as { token?: unknown };
    if (typeof token !== "string") throw new ServiceError(400, "INVALID_REQUEST");
    await removePushToken(getDb(), user.id, token);
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
