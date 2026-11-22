import { randomInt } from "node:crypto";
import { type Database, and, eq, schema, sql } from "@vybz/db";
import { z } from "zod";
import { ServiceError, type UserRow } from "./battles/service";

/**
 * Guest accounts. Someone who opens a friend's challenge can play straight
 * away as a guest (Better Auth's anonymous sign-in). Guests can take part in
 * battles they were invited or challenged into; voting, posting and starting
 * their own battles need a saved account. They save it in place with email
 * and password (same account, history kept), or by continuing with Apple or
 * Google, which moves their battles onto that account.
 */

export const GUEST_EMAIL_DOMAIN = "guest.vybz.invalid";

/** "guest_4821". */
export function guestHandleSeed(): string {
  return `guest_${randomInt(1000, 1_000_000)}`;
}

/**
 * A guest signed in to a real account (Apple, Google, or email): bring their
 * battles along, then retire the guest. Rows that would clash (both people in
 * the same battle) stay with the guest.
 */
export async function mergeGuestInto(db: Database, guestId: string, userId: string): Promise<void> {
  if (guestId === userId) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`update battle_participant p set user_id = ${userId}
      where p.user_id = ${guestId} and not exists (select 1 from battle_participant q where q.battle_id = p.battle_id and q.user_id = ${userId})`);
    await tx.execute(sql`update battle set creator_id = ${userId} where creator_id = ${guestId}`);
    await tx.execute(sql`update battle set invited_user_id = ${userId} where invited_user_id = ${guestId} and creator_id <> ${userId}`);
    await tx.execute(sql`update battle set proposed_by_id = ${userId} where proposed_by_id = ${guestId}`);
    await tx.execute(sql`update listen_proof l set user_id = ${userId}
      where l.user_id = ${guestId} and not exists (select 1 from listen_proof m where m.round_id = l.round_id and m.user_id = ${userId} and m.submission_id = l.submission_id)`);
    await tx.execute(sql`update notification set user_id = ${userId} where user_id = ${guestId}`);
    await tx.update(schema.user).set({ status: "DELETED" }).where(and(eq(schema.user.id, guestId), eq(schema.user.isAnonymous, true)));
  });
}

const SaveSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(10).max(128),
    displayName: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export interface AuthInternals {
  hashPassword: (password: string) => Promise<string>;
  linkCredential: (userId: string, hash: string) => Promise<void>;
  sendVerification: (email: string) => Promise<void>;
}

/** Turn a guest into a full account in place: same id, same handle, same battles. */
export async function saveGuestAccount(db: Database, auth: AuthInternals, user: UserRow | null, body: unknown): Promise<{ ok: true }> {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!user.isAnonymous) throw new ServiceError(409, "NOT_A_GUEST", "This account is already saved.");
  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", "Enter a valid email and a password of at least 10 characters.");
  const { email, password, displayName } = parsed.data;
  if (email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)) throw new ServiceError(400, "INVALID_EMAIL");
  const [taken] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (taken) throw new ServiceError(409, "EMAIL_TAKEN", "That email already has a VYBZ account. Sign in to it instead; your guest battles come with you.");
  const hash = await auth.hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(schema.user).set({ email, emailVerified: false, isAnonymous: false, ...(displayName ? { name: displayName } : {}) }).where(eq(schema.user.id, user.id));
  });
  await auth.linkCredential(user.id, hash);
  await auth.sendVerification(email).catch((err) => console.error("verification email failed", err));
  return { ok: true };
}
