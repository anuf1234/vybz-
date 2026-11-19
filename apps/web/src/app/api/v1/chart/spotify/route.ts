import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { exportChartToSpotify } from "@/server/verdict";

/** { week? } → saves the chart as a private playlist on the person's linked Spotify: { url, added }. */
export const POST = route(async (req) => NextResponse.json(await exportChartToSpotify(getBattleDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
