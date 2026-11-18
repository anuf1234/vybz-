import { NextResponse } from "next/server";
import { getBattleDeps, getTriviaDrafter, getTriviaOptions } from "@/server/context";
import { currentUser, noStore, route } from "@/server/http";
import { adminBankHealth } from "@/server/trivia-pipeline";

/** Staff: how many days of fresh daily trivia are left, drafts waiting, thin genres, last pipeline run. */
export const GET = route(async (req) => NextResponse.json(await adminBankHealth(getBattleDeps(), getTriviaOptions(), getTriviaDrafter(), await currentUser(req)), noStore));
