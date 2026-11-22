import { NextResponse } from "next/server";
import { getAuth } from "@/server/context";
import { getDb } from "@/server/db";
import { saveGuestAccount } from "@/server/guests";
import { currentUser, noStore, readJson, route } from "@/server/http";

/** A guest saves their account with email and password: same account, battles kept. Body: { email, password, displayName? }. */
export const POST = route(
  async (req) => {
    const auth = getAuth();
    const ctx = await auth.$context;
    const result = await saveGuestAccount(
      getDb(),
      {
        hashPassword: (p) => ctx.password.hash(p),
        linkCredential: async (userId, hash) => {
          await ctx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
        },
        sendVerification: async (email) => {
          await auth.api.sendVerificationEmail({ body: { email } });
        },
      },
      await currentUser(req),
      await readJson(req),
    );
    return NextResponse.json(result, noStore);
  },
  { mutation: true },
);
