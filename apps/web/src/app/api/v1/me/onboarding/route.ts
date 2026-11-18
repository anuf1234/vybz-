import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { onboardingState, updateOnboarding } from "@/server/onboarding";

/** The first-run path: genres → first battle → today's trivia. */
export const GET = route(async (req) => NextResponse.json(await onboardingState(getBattleDeps(), await currentUser(req)), noStore));
/** { genres: [...] } or { action: "skip" }. */
export const POST = route(async (req) => NextResponse.json(await updateOnboarding(getBattleDeps(), await currentUser(req), await readJson(req)), noStore), { mutation: true });
