"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActor } from "../auth/server";
import { battles } from "../battles";
import { AppError } from "../errors";
import { LIMITS, enforceRateLimit } from "../rate-limit";
import { type ActionResult, run } from "./run";

const Id = z.string().regex(/^[a-z0-9]{1,40}$/i, "Invalid id.");

/** Dates arrive as ISO strings from the client; the setup schema wants Date objects. */
function reviveSetup(setup: unknown): unknown {
  if (setup && typeof setup === "object" && "scheduledFor" in setup) {
    const v = (setup as { scheduledFor: unknown }).scheduledFor;
    if (typeof v === "string" && v) {
      const d = new Date(v);
      if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() - 60_000) {
        throw new AppError("INVALID", "Pick a premiere time in the future.", { scheduledFor: "Pick a time in the future." });
      }
      if (d.getTime() > Date.now() + 14 * 24 * 60 * 60_000) {
        throw new AppError("INVALID", "Premieres can be at most two weeks out.", { scheduledFor: "At most two weeks out." });
      }
      return { ...setup, scheduledFor: d };
    }
    return { ...setup, scheduledFor: null };
  }
  return setup;
}

export async function createBattle(input: {
  setup: unknown;
  opponent?: string | null;
  lineup: unknown;
  rematchOf?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  return run("battle.create", async () => {
    const actor = await getActor();
    if (actor) await enforceRateLimit(`createBattle:${actor.id}`, LIMITS.createBattle.max, LIMITS.createBattle.windowMs);
    const res = await battles.create(actor, {
      setup: reviveSetup(input.setup),
      opponent: typeof input.opponent === "string" ? input.opponent : null,
      lineup: input.lineup,
      rematchOf: input.rematchOf ? Id.parse(input.rematchOf) : null,
    });
    revalidatePath("/battle");
    return res;
  });
}

export async function findOpponent(input: { theme: string; type: string; roundCount: number }): Promise<ActionResult<{ id: string } | null>> {
  return run("battle.findMatch", async () => {
    const parsed = z
      .object({
        theme: z.string().min(1).max(60),
        type: z.enum(["SONG_FOR_SONG", "PLAYLIST", "DJ_MIX"]),
        roundCount: z.number().int().min(1).max(20),
      })
      .parse(input);
    return battles.findMatch(await getActor(), parsed);
  });
}

export async function acceptBattle(battleId: string): Promise<ActionResult> {
  return run("battle.accept", async () => {
    await battles.accept(await getActor(), Id.parse(battleId));
    revalidatePath(`/battle/${battleId}`);
  });
}

export async function cancelBattle(battleId: string): Promise<ActionResult> {
  return run("battle.cancel", async () => {
    await battles.cancel(await getActor(), Id.parse(battleId));
    revalidatePath(`/battle/${battleId}`);
  });
}

export async function submitLineup(battleId: string, lineup: unknown): Promise<ActionResult> {
  return run("battle.lineup", async () => {
    await battles.submitLineup(await getActor(), Id.parse(battleId), lineup);
    revalidatePath(`/battle/${battleId}`);
  });
}

export async function reportListen(submissionId: string, playedMs: number): Promise<ActionResult<{ playedMs: number; requiredMs: number }>> {
  return run("battle.listen", async () => {
    const actor = await getActor();
    if (actor) await enforceRateLimit(`listen:${actor.id}`, LIMITS.listen.max, LIMITS.listen.windowMs);
    const input = z.object({ submissionId: Id, playedMs: z.number().int().min(0).max(4 * 60 * 60_000) }).parse({
      submissionId,
      playedMs: Math.floor(playedMs),
    });
    return battles.reportListen(actor, input);
  });
}

export async function castVote(battleId: string, roundIndex: number, selection: number): Promise<ActionResult<{ votes: [number, number] }>> {
  return run("battle.vote", async () => {
    const actor = await getActor();
    if (actor) await enforceRateLimit(`vote:${actor.id}`, LIMITS.vote.max, LIMITS.vote.windowMs);
    const input = z
      .object({ battleId: Id, roundIndex: z.number().int().min(0).max(19), selection: z.union([z.literal(0), z.literal(1)]) })
      .parse({ battleId, roundIndex, selection });
    const res = await battles.vote(actor, input);
    revalidatePath(`/battle/${battleId}`);
    return res;
  });
}
