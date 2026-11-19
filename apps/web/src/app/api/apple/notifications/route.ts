import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { appleNotification } from "@/server/pro";

/**
 * App Store Server Notifications V2. Set this URL as the Production and
 * Sandbox notification URL in App Store Connect (App Information). Always
 * answers 200; the subscription's state is re-read from Apple's API.
 */
export async function POST(req: Request) {
  const text = await req.text();
  let body: unknown = null;
  try {
    body = text.length < 100_000 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return NextResponse.json(await appleNotification(getBattleDeps(), body));
}
