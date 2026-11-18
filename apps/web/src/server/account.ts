import { randomBytes } from "node:crypto";
import { type Database, eq, or, schema } from "@vybz/db";
import { z } from "zod";
import { ServiceError, type UserRow } from "./battles/service";

/**
 * Deleting an account (Apple requires it in-app; Meta and TikTok ask for it).
 * Personal content and connections are removed; the user row stays as an
 * anonymous "Deleted user" so finished battles and votes still add up.
 */

const Schema = z.object({ confirm: z.literal("DELETE") }).strict();

export async function deleteAccount(db: Database, user: UserRow | null, body: unknown): Promise<void> {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!Schema.safeParse(body).success) throw new ServiceError(400, "CONFIRM_REQUIRED", 'Send { "confirm": "DELETE" } to delete your account.');
  const id = user.id;
  await db.transaction(async (tx) => {
    // Sign-in methods and sessions: nobody can sign in as this account again.
    await tx.delete(schema.session).where(eq(schema.session.userId, id));
    await tx.delete(schema.account).where(eq(schema.account.userId, id));
    await tx.delete(schema.verification).where(eq(schema.verification.identifier, user.email));
    await tx.delete(schema.pushToken).where(eq(schema.pushToken.userId, id));
    // What they posted and who they're connected to.
    await tx.delete(schema.post).where(eq(schema.post.authorId, id));
    await tx.delete(schema.postComment).where(eq(schema.postComment.authorId, id));
    await tx.delete(schema.chatMessage).where(eq(schema.chatMessage.userId, id));
    await tx.delete(schema.conversation).where(or(eq(schema.conversation.userA, id), eq(schema.conversation.userB, id)));
    await tx.delete(schema.follow).where(or(eq(schema.follow.followerId, id), eq(schema.follow.followeeId, id)));
    await tx.delete(schema.block).where(or(eq(schema.block.blockerId, id), eq(schema.block.blockedId, id)));
    await tx.delete(schema.postLike).where(eq(schema.postLike.userId, id));
    await tx.delete(schema.commentLike).where(eq(schema.commentLike.userId, id));
    await tx.delete(schema.chatLike).where(eq(schema.chatLike.userId, id));
    await tx.delete(schema.libraryTrack).where(eq(schema.libraryTrack.userId, id));
    await tx.delete(schema.playlist).where(eq(schema.playlist.ownerId, id));
    await tx.delete(schema.notification).where(eq(schema.notification.userId, id));
    // Progression.
    await tx.delete(schema.ledgerEntry).where(eq(schema.ledgerEntry.userId, id));
    await tx.delete(schema.userAchievement).where(eq(schema.userAchievement.userId, id));
    await tx.delete(schema.dailyClaim).where(eq(schema.dailyClaim.userId, id));
    await tx.delete(schema.userItem).where(eq(schema.userItem.userId, id));
    await tx.delete(schema.userProgress).where(eq(schema.userProgress.userId, id));
    await tx.delete(schema.reminderSent).where(eq(schema.reminderSent.userId, id));
    // The row itself: anonymous from here on.
    const tag = randomBytes(5).toString("hex");
    await tx
      .update(schema.user)
      .set({ name: "Deleted user", handle: `deleted_${tag}`, email: `deleted-${id}@deleted.invalid`, emailVerified: false, image: null, status: "DELETED" })
      .where(eq(schema.user.id, id));
  });
}
