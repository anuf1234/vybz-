import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { reviewArtistProfile } from "@/server/artists";

/** { action: "verify" | "reject" } */
export const POST = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await reviewArtistProfile(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req)), noStore),
  { mutation: true },
);
