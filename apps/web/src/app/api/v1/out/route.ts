import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { outboundLink } from "@/server/outbound";

/** { service: "spotify" | "apple" | "youtube" | "source", kind: "release" | "war" | "track", id, side? } → { url }. Logs the tap. */
export const POST = route(async (req) => NextResponse.json(await outboundLink(getBattleDeps(), await currentUser(req), req.headers.get("x-vybz-viewer"), await readJson(req)), noStore), { mutation: true });
