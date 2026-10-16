"use server";

import { HandleSchema, ProfileUpdateSchema, can } from "@vybz/core";
import { Prisma, prisma } from "@vybz/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActor, safeNext } from "../auth/server";
import { fieldErrors } from "../errors";
import { log } from "../log";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean };

/** Onboarding: claim a permanent @username and set a display name. */
export async function claimUsername(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const decision = can(actor, { type: "profile.setHandle", target: { id: actor.id, handle: actor.handle } });
  if (!decision.allow) {
    if (decision.reason === "HANDLE_ALREADY_SET") redirect(`/profile/${actor.handle}`);
    return { error: "You can't change this right now." };
  }

  const username = HandleSchema.safeParse(form.get("username") ?? "");
  if (!username.success) return { fieldErrors: { username: username.error.issues[0]?.message ?? "Invalid username." } };
  const rest = ProfileUpdateSchema.pick({ name: true }).safeParse({ name: form.get("displayName") ?? "" });
  if (!rest.success) return { fieldErrors: { displayName: rest.error.issues[0]?.message ?? "Invalid name." } };

  try {
    // The profile's primary key is the user id, so two tabs racing can't create two.
    await prisma.profile.create({ data: { userId: actor.id, username: username.data, displayName: rest.data.name } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = String((err.meta as { target?: unknown })?.target ?? "");
      if (target.includes("userId") || target.includes("pkey")) redirect("/");
      return { fieldErrors: { username: "That username is taken." } };
    }
    throw err;
  }
  log.info("profile.created", { userId: actor.id });
  redirect(safeNext(String(form.get("next") ?? ""), "/battle/create?welcome=1"));
}

/** Settings: display name, bio and favorite genres. */
export async function updateProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.handle) redirect("/onboarding");
  if (!can(actor, { type: "profile.update", target: { id: actor.id } }).allow) {
    return { error: "You can't edit this profile." };
  }

  const parsed = ProfileUpdateSchema.safeParse({
    name: form.get("displayName") ?? "",
    bio: form.get("bio") ?? "",
    favoriteGenres: form.getAll("favoriteGenres"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  await prisma.profile.update({
    where: { userId: actor.id },
    data: { displayName: parsed.data.name, bio: parsed.data.bio, favoriteGenres: parsed.data.favoriteGenres },
  });
  revalidatePath(`/profile/${actor.handle}`);
  return { ok: true };
}
