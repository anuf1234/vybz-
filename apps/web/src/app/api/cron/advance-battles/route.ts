import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { battles } from "@/lib/battles";

/**
 * Deadline sweep. Battles also advance whenever someone opens them, so this
 * only keeps lists and (later) notifications current for battles nobody is
 * looking at. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const advanced = await battles.advanceDue(200);
  return NextResponse.json({ advanced });
}
