/**
 * Comments, reactions and follows. Framework-free, like the battle service.
 * All text is stored as plain text and rendered escaped.
 */
import { type Actor, HandleSchema, can, plainLine } from "@vybz/core";
import { Prisma, type PrismaClient, type ReactionKind } from "@vybz/db";
import { AppError } from "../errors";

export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: "FIRE", emoji: "🔥", label: "Fire" },
  { kind: "HEART", emoji: "❤️", label: "Love" },
  { kind: "LAUGH", emoji: "😂", label: "Funny" },
  { kind: "MIND_BLOWN", emoji: "🤯", label: "Mind blown" },
  { kind: "CLAP", emoji: "👏", label: "Respect" },
];

const CommentBody = plainLine(1, 500, "Your comment");

function gate(decision: ReturnType<typeof can>) {
  if (!decision.allow) {
    throw new AppError(decision.reason === "SIGN_IN_REQUIRED" ? "UNAUTHORIZED" : "FORBIDDEN", "Sign in with a confirmed account and a username to join in.");
  }
}

export function socialService({ prisma }: { prisma: PrismaClient }) {
  async function liveBattle(battleId: string) {
    const b = await prisma.battle.findUnique({ where: { id: battleId }, select: { id: true, status: true } });
    if (!b || b.status === "DRAFT") throw new AppError("NOT_FOUND", "That battle doesn't exist.");
    return b;
  }

  return {
    async comment(actor: Actor | null, input: { battleId: string; body: unknown; roundIndex?: number | null }) {
      gate(can(actor, { type: "comment.create" }));
      await liveBattle(input.battleId);
      const body = CommentBody.safeParse(input.body);
      if (!body.success) throw new AppError("INVALID", body.error.issues[0]?.message ?? "That comment isn't valid.");
      const round =
        input.roundIndex != null
          ? await prisma.battleRound.findUnique({ where: { battleId_index: { battleId: input.battleId, index: input.roundIndex } }, select: { id: true } })
          : null;
      return prisma.comment.create({
        data: { battleId: input.battleId, roundId: round?.id ?? null, authorId: actor!.id, body: body.data },
        select: { id: true },
      });
    },

    /** Authors delete their own; moderators hide anyone's. */
    async removeComment(actor: Actor | null, commentId: string) {
      if (!actor) throw new AppError("UNAUTHORIZED", "Sign in first.");
      const c = await prisma.comment.findUnique({ where: { id: commentId }, select: { authorId: true } });
      if (!c) throw new AppError("NOT_FOUND", "That comment is gone.");
      if (c.authorId === actor.id) {
        await prisma.comment.update({ where: { id: commentId }, data: { status: "DELETED" } });
      } else if (can(actor, { type: "comment.moderate" }).allow) {
        await prisma.comment.update({ where: { id: commentId }, data: { status: "HIDDEN" } });
      } else {
        throw new AppError("FORBIDDEN", "You can only remove your own comments.");
      }
    },

    /** Adds or removes one reaction on a round. Returns the round's counts. */
    async toggleReaction(actor: Actor | null, input: { battleId: string; roundIndex: number; kind: ReactionKind }) {
      gate(can(actor, { type: "reaction.add" }));
      if (!REACTIONS.some((r) => r.kind === input.kind)) throw new AppError("INVALID", "Unknown reaction.");
      const b = await liveBattle(input.battleId);
      if (!["ACTIVE", "VOTING", "COMPLETED"].includes(b.status)) throw new AppError("CONFLICT", "Reactions open when the battle goes live.");
      const round = await prisma.battleRound.findUnique({
        where: { battleId_index: { battleId: input.battleId, index: input.roundIndex } },
        select: { id: true },
      });
      if (!round) throw new AppError("NOT_FOUND", "That round doesn't exist.");
      const key = { roundId_userId_kind: { roundId: round.id, userId: actor!.id, kind: input.kind } };
      const existing = await prisma.reaction.findUnique({ where: key, select: { id: true } });
      if (existing) await prisma.reaction.delete({ where: { id: existing.id } });
      else {
        await prisma.reaction.create({ data: { roundId: round.id, userId: actor!.id, kind: input.kind } }).catch((err) => {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
        });
      }
      return { reacted: !existing };
    },

    async follow(actor: Actor | null, username: string) {
      const handle = HandleSchema.safeParse(username);
      const target = handle.success ? await prisma.profile.findUnique({ where: { username: handle.data }, select: { userId: true } }) : null;
      if (!target) throw new AppError("NOT_FOUND", "We couldn't find that person.");
      gate(can(actor, { type: "user.follow", target: { id: target.userId } }));
      const { count } = await prisma.follow.createMany({
        data: [{ followerId: actor!.id, followeeId: target.userId }],
        skipDuplicates: true,
      });
      if (count === 1) {
        await prisma.notification.create({ data: { recipientId: target.userId, actorId: actor!.id, type: "NEW_FOLLOWER" } });
      }
    },

    async unfollow(actor: Actor | null, username: string) {
      if (!actor) throw new AppError("UNAUTHORIZED", "Sign in first.");
      const handle = HandleSchema.safeParse(username);
      const target = handle.success ? await prisma.profile.findUnique({ where: { username: handle.data }, select: { userId: true } }) : null;
      if (!target) return;
      await prisma.follow.deleteMany({ where: { followerId: actor.id, followeeId: target.userId } });
    },
  };
}
