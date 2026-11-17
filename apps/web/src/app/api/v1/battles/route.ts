import type { BattleFeed, BattleListResponse } from "@vybz/core";
import { NextResponse } from "next/server";
import { createBattle, listBattles } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";

const FEEDS: BattleFeed[] = ["home", "open", "mine", "vote", "featured", "daily"];

export const GET = route(async (req) => {
  const raw = new URL(req.url).searchParams.get("feed") ?? "home";
  const feed = (FEEDS as string[]).includes(raw) ? (raw as BattleFeed) : "home";
  const body: BattleListResponse = { items: await listBattles(getBattleDeps(), await currentUser(req), feed) };
  return NextResponse.json(body, noStore);
});

export const POST = route(
  async (req) => {
    const result = await createBattle(getBattleDeps(), await currentUser(req), await readJson(req));
    return NextResponse.json(result, { status: 201 });
  },
  { mutation: true },
);
