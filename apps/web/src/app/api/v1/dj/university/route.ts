import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { djUniversity } from "@/server/dj";

/** DJ University: every lesson with your progress. */
export const GET = route(async (req) => NextResponse.json(await djUniversity(getBattleDeps(), await currentUser(req)), noStore));
void readJson;
