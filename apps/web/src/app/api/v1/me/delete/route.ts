import { NextResponse } from "next/server";
import { deleteAccount } from "@/server/account";
import { getBattleDeps } from "@/server/context";
import { currentUser, readJson, route } from "@/server/http";

/** Delete your account. Body: { confirm: "DELETE" }. */
export const POST = route(
  async (req) => {
    await deleteAccount(getBattleDeps().db, await currentUser(req), await readJson(req));
    return new NextResponse(null, { status: 204 });
  },
  { mutation: true },
);
