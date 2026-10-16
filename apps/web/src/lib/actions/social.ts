"use server";

import { prisma } from "@vybz/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActor } from "../auth/server";
import { LIMITS, enforceRateLimit } from "../rate-limit";
import { socialService } from "../social/service";
import { type ActionResult, run } from "./run";

const social = socialService({ prisma });
const Id = z.string().regex(/^[a-z0-9]{1,40}$/i, "Invalid id.");
const Kind = z.enum(["FIRE", "HEART", "LAUGH", "MIND_BLOWN", "CLAP"]);

export async function postComment(battleId: string, body: string, roundIndex: number | null): Promise<ActionResult> {
  return run("comment.create", async () => {
    const actor = await getActor();
    if (actor) await enforceRateLimit(`comment:${actor.id}`, LIMITS.comment.max, LIMITS.comment.windowMs);
    await social.comment(actor, {
      battleId: Id.parse(battleId),
      body,
      roundIndex: roundIndex === null ? null : z.number().int().min(0).max(19).parse(roundIndex),
    });
    revalidatePath(`/battle/${battleId}`);
  });
}

export async function removeComment(battleId: string, commentId: string): Promise<ActionResult> {
  return run("comment.remove", async () => {
    await social.removeComment(await getActor(), Id.parse(commentId));
    revalidatePath(`/battle/${battleId}`);
  });
}

export async function toggleReaction(battleId: string, roundIndex: number, kind: string): Promise<ActionResult<{ reacted: boolean }>> {
  return run("reaction.toggle", async () => {
    const actor = await getActor();
    if (actor) await enforceRateLimit(`reaction:${actor.id}`, LIMITS.reaction.max, LIMITS.reaction.windowMs);
    const res = await social.toggleReaction(actor, {
      battleId: Id.parse(battleId),
      roundIndex: z.number().int().min(0).max(19).parse(roundIndex),
      kind: Kind.parse(kind),
    });
    revalidatePath(`/battle/${battleId}`);
    return res;
  });
}

export async function setFollow(username: string, follow: boolean): Promise<ActionResult> {
  return run("follow.set", async () => {
    const actor = await getActor();
    if (actor) await enforceRateLimit(`follow:${actor.id}`, LIMITS.follow.max, LIMITS.follow.windowMs);
    if (follow) await social.follow(actor, username);
    else await social.unfollow(actor, username);
    revalidatePath(`/profile/${username}`);
  });
}

export async function markNotificationsRead(): Promise<ActionResult> {
  return run("notifications.read", async () => {
    const actor = await getActor();
    if (!actor) return;
    await prisma.notification.updateMany({ where: { recipientId: actor.id, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/notifications");
  });
}
