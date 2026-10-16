"use server";

import { HandleSchema, ProfileUpdateSchema, can } from "@vybz/core";
import { Prisma, prisma } from "@vybz/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActor } from "../auth/server";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean };

/** Onboarding: claim a permanent @handle. */
export async function claimHandle(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");

  const decision = can(actor, { type: "profile.setHandle", target: { id: actor.id, handle: actor.handle } });
  if (!decision.allow) {
    if (decision.reason === "HANDLE_ALREADY_SET") redirect(`/u/${actor.handle}`);
    return { error: "You can't change this right now." };
  }

  const parsed = HandleSchema.safeParse(form.get("handle") ?? "");
  if (!parsed.success) return { fieldErrors: { handle: parsed.error.issues[0]?.message ?? "Invalid handle." } };

  try {
    // `handle: null` in the filter makes this a compare-and-set, so two tabs
    // racing can't overwrite a handle that was just claimed.
    const { count } = await prisma.user.updateMany({
      where: { id: actor.id, handle: null },
      data: { handle: parsed.data },
    });
    if (count === 0) redirect("/onboarding");
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { fieldErrors: { handle: "That handle is taken." } };
    }
    throw err;
  }

  redirect(`/u/${parsed.data}`);
}

/** Settings: update display name and bio. */
export async function updateProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!can(actor, { type: "profile.update", target: { id: actor.id } }).allow) {
    return { error: "You can't edit this profile." };
  }

  const parsed = ProfileUpdateSchema.safeParse({ name: form.get("name") ?? "", bio: form.get("bio") ?? "" });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors };
  }

  await prisma.user.update({ where: { id: actor.id }, data: parsed.data });
  if (actor.handle) revalidatePath(`/u/${actor.handle}`);
  return { ok: true };
}
