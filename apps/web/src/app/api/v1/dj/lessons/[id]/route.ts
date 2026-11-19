import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { djLessonContent, djLessonStep } from "@/server/dj";

/** Record a lesson step: { step: "learn" | "demo" | "practice", check? } or { step: "quiz", answers }. */
export const POST = route<{ id: string }>(
  async (req, { params }) => NextResponse.json(await djLessonStep(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req)), noStore),
  { mutation: true },
);

/** The lesson's content (Pro for courses past the free ones). */
export const GET = route<{ id: string }>(async (req, { params }) => NextResponse.json(await djLessonContent(getBattleDeps(), await currentUser(req), (await params).id), noStore));
