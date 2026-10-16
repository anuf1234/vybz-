"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getActor } from "../auth/server";
import { BattleError, battles, catalogPort } from "../battles";

export type ActionResult = { error?: string };
export type CreateState = { error?: string; fieldErrors?: Record<string, string> };

const Id = z.string().min(1).max(40).regex(/^[a-z0-9]+$/i);
const AppleId = z.string().min(1).max(40).regex(/^[\w-]+$/);

/** Turns expected refusals into a message; anything else is a real error. */
async function attempt(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    return {};
  } catch (err) {
    if (err instanceof BattleError) return { error: err.message };
    if (err instanceof z.ZodError) return { error: "That request wasn't valid." };
    throw err;
  }
}

function year(v: FormDataEntryValue | null): number | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : Number(s);
}

export async function createBattle(_prev: CreateState, form: FormData): Promise<CreateState> {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");

  let id: string;
  try {
    ({ id } = await battles.create(actor, {
      theme: form.get("theme") ?? "",
      rules: {
        roundCount: Number(form.get("roundCount")),
        pace: form.get("pace"),
        eraFrom: year(form.get("eraFrom")),
        eraTo: year(form.get("eraTo")),
      },
      opponentHandle: String(form.get("opponent") ?? "").replace(/^@/, ""),
    }));
  } catch (err) {
    if (err instanceof BattleError) return { error: err.message };
    throw err;
  }
  revalidatePath("/battles");
  redirect(`/battles/${id}`);
}

export async function acceptBattle(battleId: string): Promise<ActionResult> {
  const actor = await getActor();
  const result = await attempt(() => battles.accept(actor, Id.parse(battleId)));
  revalidatePath(`/battles/${battleId}`);
  return result;
}

export async function cancelBattle(battleId: string): Promise<ActionResult> {
  const actor = await getActor();
  const result = await attempt(() => battles.cancel(actor, Id.parse(battleId)));
  revalidatePath(`/battles/${battleId}`);
  return result;
}

export async function submitPick(battleId: string, roundIndex: number, appleId: string): Promise<ActionResult> {
  const actor = await getActor();
  const catalog = catalogPort;
  if (!catalog) return { error: "Track search isn't available right now." };
  const input = z
    .object({ battleId: Id, roundIndex: z.number().int().min(0).max(20), appleId: AppleId })
    .safeParse({ battleId, roundIndex, appleId });
  if (!input.success) return { error: "That pick wasn't valid." };
  const result = await attempt(() => battles.submitTrack(actor, input.data, catalog));
  revalidatePath(`/battles/${battleId}`);
  return result;
}

export async function reportListen(
  submissionId: string,
  playedMs: number,
): Promise<{ playedMs: number; requiredMs: number } | { error: string }> {
  const actor = await getActor();
  const input = z
    .object({ submissionId: Id, playedMs: z.number().int().min(0).max(3_600_000) })
    .safeParse({ submissionId, playedMs: Math.floor(playedMs) });
  if (!input.success) return { error: "Invalid progress." };
  try {
    return await battles.reportListen(actor, input.data);
  } catch (err) {
    if (err instanceof BattleError) return { error: err.message };
    throw err;
  }
}

export async function castVote(battleId: string, submissionId: string): Promise<ActionResult> {
  const actor = await getActor();
  const result = await attempt(() => battles.vote(actor, Id.parse(submissionId)));
  revalidatePath(`/battles/${battleId}`);
  return result;
}

export async function requestRematch(battleId: string): Promise<ActionResult> {
  const actor = await getActor();
  let id: string;
  try {
    ({ id } = await battles.rematch(actor, Id.parse(battleId)));
  } catch (err) {
    if (err instanceof BattleError) return { error: err.message };
    throw err;
  }
  redirect(`/battles/${id}`);
}
