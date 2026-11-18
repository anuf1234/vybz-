import { NextResponse } from "next/server";
import { getBattleDeps } from "@/server/context";
import { currentUser, noStore, readJson, route } from "@/server/http";
import { deleteDjSet, getDjSet, renameDjSet } from "@/server/dj";

type P = { id: string };
export const GET = route<P>(async (req, { params }) => NextResponse.json(await getDjSet(getBattleDeps(), await currentUser(req), (await params).id), noStore));
export const PATCH = route<P>(async (req, { params }) => NextResponse.json(await renameDjSet(getBattleDeps(), await currentUser(req), (await params).id, await readJson(req))), { mutation: true });
export const DELETE = route<P>(async (req, { params }) => NextResponse.json(await deleteDjSet(getBattleDeps(), await currentUser(req), (await params).id)), { mutation: true });
