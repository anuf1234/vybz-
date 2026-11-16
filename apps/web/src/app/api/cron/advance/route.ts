import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { advanceAllDue, ensureAllAiVerdicts } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { serverEnv } from "@/server/env";

/**
 * Closes rounds whose deadlines have passed. Battles also advance lazily when
 * read, so this only matters for battles nobody is looking at. Schedule it
 * every minute (vercel.json) with `Authorization: Bearer $CRON_SECRET`.
 */
async function handle(req: Request) {
  const secret = serverEnv().CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const deps = getBattleDeps();
  // Verdicts first, so AI-judged rounds closing now can be scored.
  const judged = await ensureAllAiVerdicts(deps);
  const advanced = await advanceAllDue(deps);
  return NextResponse.json({ advanced, judged });
}

export { handle as GET, handle as POST };
