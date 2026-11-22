import { NextResponse } from "next/server";
import { battleByCode } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, route } from "@/server/http";

/** Look up a private challenge by its six-letter code. Signed in (guests count), so codes can't be scanned anonymously. */
export const GET = route<{ code: string }>(async (req, { params }) => {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "SIGN_IN_REQUIRED", message: "Sign in or play as a guest to use a code." }, { status: 401 });
  return NextResponse.json(await battleByCode(getBattleDeps(), user.id, (await params).code));
});
