import { DisplayNameSchema, HandleSchema, type MeView } from "@vybz/core";
import { schema, eq } from "@vybz/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceError, type UserRow } from "@/server/battles/service";
import { getDb } from "@/server/db";
import { currentUser, noStore, readJson, route } from "@/server/http";

function toMe(u: UserRow): MeView {
  return { id: u.id, handle: u.handle, displayName: u.name, image: u.image, email: u.email, emailVerified: u.emailVerified, role: u.role, createdAt: u.createdAt.toISOString() };
}

export const GET = route(async (req) => {
  const u = await currentUser(req);
  if (!u) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  return NextResponse.json(toMe(u), noStore);
});

const PatchSchema = z.object({ handle: HandleSchema.optional(), displayName: DisplayNameSchema.optional() }).strict();

export const PATCH = route(
  async (req) => {
    const u = await currentUser(req);
    if (!u) throw new ServiceError(401, "SIGN_IN_REQUIRED");
    const parsed = PatchSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
    const { handle, displayName } = parsed.data;
    try {
      const [row] = await getDb()
        .update(schema.user)
        .set({ ...(handle ? { handle } : {}), ...(displayName ? { name: displayName } : {}) })
        .where(eq(schema.user.id, u.id))
        .returning();
      return NextResponse.json(toMe(row!), noStore);
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === "23505") throw new ServiceError(409, "HANDLE_TAKEN", "That handle is taken.");
      throw err;
    }
  },
  { mutation: true },
);
