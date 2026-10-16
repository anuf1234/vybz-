/**
 * Battle use cases: authorization, validation and persistence around the
 * pure state machine in @vybz/core. Framework-free (no Next.js imports) so it
 * runs in integration tests against a real database.
 *
 * Every state change locks the battle row, applies transitions that are due,
 * then the requested action, then persists. Votes, accepts and deadlines can
 * never race each other.
 */
import {
  type Actor,
  type BattleSetup,
  BattleRuleError,
  BattleSetupSchema,
  type BattleState,
  type Side,
  type Transition,
  HandleSchema,
  accept,
  advance,
  assertRoundVotable,
  can,
  cancel,
  creditListen,
  lineupSize,
  lockLineup,
  newDraft,
  requiredListenMs,
  revealedRounds,
  send,
} from "@vybz/core";
import { Prisma, type PrismaClient } from "@vybz/db";
import { z } from "zod";
import { AppError, invalid } from "../errors";
import { awardXP, grantBadge } from "../progression";
import { type CatalogPort, type ResolvedTrack, resolveLineup } from "./lineup";
import { type LockedBattle, lockBattle, persist, toState } from "./model";

export interface Deps {
  prisma: PrismaClient;
  catalog: CatalogPort | null;
  now?: () => Date;
}

/** What a player brings: Apple Music ids (songs and playlists) or an uploaded mix. */
export const LineupSchema = z.union([
  z.object({ appleIds: z.array(z.string().regex(/^[\w-]{1,40}$/)).min(1).max(20) }),
  z.object({ uploadId: z.string().regex(/^[a-z0-9]{1,40}$/i) }),
]);
export type LineupInput = z.infer<typeof LineupSchema>;

const MAX_PENDING_CHALLENGES = 10;

const DENY: Record<string, string> = {
  SIGN_IN_REQUIRED: "Sign in first.",
  EMAIL_UNVERIFIED: "Confirm your email first.",
  ONBOARDING_REQUIRED: "Pick your username first.",
  ACCOUNT_RESTRICTED: "Your account can't do this right now.",
};

function authorize(decision: ReturnType<typeof can>): void {
  if (!decision.allow) {
    throw new AppError(decision.reason === "SIGN_IN_REQUIRED" ? "UNAUTHORIZED" : "FORBIDDEN", DENY[decision.reason] ?? "You can't do that.");
  }
}

function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof BattleRuleError) throw new AppError("CONFLICT", err.message);
    throw err;
  }
}

type Tx = Prisma.TransactionClient;
type MutateCtx = { tx: Tx; battle: LockedBattle; state: BattleState; transitions: Transition[]; at: Date };

export function battleService({ prisma, catalog, now = () => new Date() }: Deps) {
  /**
   * Lock, advance to now, run `action`, persist. When the action refuses, the
   * transitions that were already due are still committed.
   */
  async function mutate<T>(
    battleId: string,
    actorId: string | null,
    action: (ctx: MutateCtx) => Promise<{ state: BattleState; transitions?: Transition[]; result: T }>,
  ): Promise<T> {
    const outcome = await prisma.$transaction(async (tx) => {
      const battle = await lockBattle(tx, battleId);
      if (!battle) throw new AppError("NOT_FOUND", "That battle doesn't exist.");
      const at = now();
      const due = advance(toState(battle), at);
      try {
        const out = await action({ tx, battle, state: due.state, transitions: due.transitions, at });
        await persist(tx, battle, out.state, [...due.transitions, ...(out.transitions ?? [])], actorId);
        return { ok: true as const, result: out.result };
      } catch (err) {
        if (err instanceof AppError || err instanceof BattleRuleError) {
          // Actions refuse before writing, so the transaction is still usable.
          await persist(tx, battle, due.state, due.transitions);
          return { ok: false as const, error: err };
        }
        throw err;
      }
    });
    if (!outcome.ok) {
      const e = outcome.error;
      throw e instanceof BattleRuleError ? new AppError("CONFLICT", e.message) : e;
    }
    return outcome.result;
  }

  /** Writes one side's entries: a submission per round, a playlist, or a mix. */
  async function writeLineup(
    tx: Tx,
    battle: { id: string; type: BattleSetup["type"]; roundCount: number; theme: string },
    participant: { id: string; userId: string; side: number },
    lineup: { tracks: ResolvedTrack[] } | { uploadId: string },
    ownerName: string,
    at: Date,
  ) {
    const rounds = await tx.battleRound.findMany({ where: { battleId: battle.id }, select: { id: true, index: true }, orderBy: { index: "asc" } });
    if (battle.type === "SONG_FOR_SONG" && "tracks" in lineup) {
      await tx.battleSubmission.createMany({
        data: rounds.map((r) => ({
          battleId: battle.id,
          roundId: r.id,
          participantId: participant.id,
          side: participant.side,
          trackId: lineup.tracks[r.index]!.trackId,
        })),
      });
    } else if (battle.type === "PLAYLIST" && "tracks" in lineup) {
      const playlist = await tx.playlist.create({
        data: {
          ownerId: participant.userId,
          kind: "BATTLE_ENTRY",
          title: `${ownerName}'s ${battle.theme}`.slice(0, 80),
          tracks: { create: lineup.tracks.map((t, position) => ({ trackId: t.trackId, position })) },
        },
        select: { id: true },
      });
      await tx.battleSubmission.create({
        data: { battleId: battle.id, roundId: rounds[0]!.id, participantId: participant.id, side: participant.side, playlistId: playlist.id },
      });
    } else if (battle.type === "DJ_MIX" && "uploadId" in lineup) {
      await tx.battleSubmission.create({
        data: { battleId: battle.id, roundId: rounds[0]!.id, participantId: participant.id, side: participant.side, uploadId: lineup.uploadId },
      });
    } else {
      throw new AppError("INVALID", "That lineup doesn't fit this battle.");
    }
    await tx.battleParticipant.update({ where: { id: participant.id }, data: { lineupLockedAt: at } });
  }

  /** Validates a lineup against the battle and resolves it outside any lock. */
  async function prepareLineup(
    actorId: string,
    setup: Pick<BattleSetup, "type" | "roundCount" | "playlistLength" | "eraFrom" | "eraTo">,
    raw: unknown,
  ): Promise<{ tracks: ResolvedTrack[] } | { uploadId: string }> {
    const parsed = LineupSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID", "Pick your songs first.");
    const lineup = parsed.data;
    const size = lineupSize(setup);
    if (setup.type === "DJ_MIX") {
      if (!("uploadId" in lineup)) throw new AppError("INVALID", "Upload your mix first.");
      const upload = await prisma.upload.findUnique({ where: { id: lineup.uploadId }, select: { ownerId: true, kind: true, status: true } });
      if (!upload || upload.ownerId !== actorId || upload.kind !== "MIX") throw new AppError("INVALID", "We couldn't find that mix.");
      if (upload.status !== "READY") throw new AppError("INVALID", "Your mix is still uploading or was rejected.");
      return { uploadId: lineup.uploadId };
    }
    if (!("appleIds" in lineup)) throw new AppError("INVALID", "Pick your songs first.");
    if (lineup.appleIds.length !== size) {
      throw new AppError("INVALID", `Pick exactly ${size} song${size === 1 ? "" : "s"}. You have ${lineup.appleIds.length}.`);
    }
    return { tracks: await resolveLineup(prisma, catalog, lineup.appleIds, setup) };
  }

  async function profileName(userId: string): Promise<string> {
    const p = await prisma.profile.findUnique({ where: { userId }, select: { username: true } });
    return p ? `@${p.username}` : "Player";
  }

  return {
    /** Applies any due transitions. Safe to call on every page view. */
    async advance(battleId: string): Promise<void> {
      await mutate(battleId, null, async ({ state }) => ({ state, result: undefined }));
    },

    /** Sweeps battles whose next deadline has passed. For the cron route and list pages. */
    async advanceDue({ limit = 50, userId }: { limit?: number; userId?: string } = {}): Promise<number> {
      const due = await prisma.battle.findMany({
        where: {
          nextDeadline: { lte: now() },
          ...(userId ? { OR: [{ participants: { some: { userId } } }, { invitedUserId: userId }, { creatorId: userId }] } : {}),
        },
        select: { id: true },
        orderBy: { nextDeadline: "asc" },
        take: limit,
      });
      for (const { id } of due) await this.advance(id);
      return due.length;
    },

    /**
     * Creates a battle with the challenger's lineup locked and sends it:
     * DRAFT → CHALLENGE_SENT in one step, so a challenge always arrives with
     * picks in place.
     */
    async create(
      actor: Actor | null,
      input: { setup: unknown; opponent?: string | null; lineup: unknown; rematchOf?: string | null },
    ): Promise<{ id: string }> {
      authorize(can(actor, { type: "battle.create" }));
      const me = actor!;
      const parsed = BattleSetupSchema.safeParse(input.setup);
      if (!parsed.success) throw invalid(parsed.error);
      const setup = parsed.data;

      let invitedUserId: string | null = null;
      let rematchOfId: string | null = null;
      if (input.rematchOf) {
        const prev = await prisma.battle.findUnique({
          where: { id: input.rematchOf },
          select: { status: true, participants: { select: { userId: true } } },
        });
        if (!prev || prev.status !== "COMPLETED" || !prev.participants.some((p) => p.userId === me.id)) {
          throw new AppError("FORBIDDEN", "You can only ask for a rematch of a finished battle you played in.");
        }
        invitedUserId = prev.participants.find((p) => p.userId !== me.id)!.userId;
        rematchOfId = input.rematchOf;
      } else if (setup.mode === "DIRECT") {
        const handle = HandleSchema.safeParse(input.opponent ?? "");
        const opponent = handle.success
          ? await prisma.profile.findUnique({ where: { username: handle.data }, select: { userId: true, user: { select: { status: true } } } })
          : null;
        if (!opponent || opponent.user.status !== "ACTIVE") {
          throw new AppError("INVALID", "We couldn't find that @username.", { opponent: "We couldn't find that @username." });
        }
        if (opponent.userId === me.id) throw new AppError("INVALID", "You can't challenge yourself.", { opponent: "You can't challenge yourself." });
        invitedUserId = opponent.userId;
      }
      if (rematchOfId && setup.mode !== "DIRECT") throw new AppError("INVALID", "A rematch goes straight to your opponent.");

      const pending = await prisma.battle.count({ where: { creatorId: me.id, status: { in: ["CHALLENGE_SENT", "ACCEPTED"] } } });
      if (pending >= MAX_PENDING_CHALLENGES) {
        throw new AppError("CONFLICT", `You already have ${MAX_PENDING_CHALLENGES} challenges waiting. Finish or withdraw one first.`);
      }

      const lineup = await prepareLineup(me.id, setup, input.lineup);
      const at = now();
      const name = await profileName(me.id);

      return prisma.$transaction(async (tx) => {
        const created = await tx.battle.create({
          data: {
            type: setup.type,
            status: "DRAFT",
            visibility: setup.visibility,
            mode: rematchOfId ? "DIRECT" : setup.mode,
            title: setup.title,
            theme: setup.theme,
            genre: setup.genre,
            tagline: setup.tagline,
            roundCount: setup.roundCount,
            playlistLength: setup.playlistLength,
            eraFrom: setup.eraFrom,
            eraTo: setup.eraTo,
            votingDurationMs: setup.votingDurationMs,
            revealIntervalMs: setup.revealIntervalMs,
            hideTotals: setup.hideTotals,
            scheduledFor: setup.scheduledFor,
            creatorId: me.id,
            invitedUserId,
            rematchOfId,
            createdAt: at,
            participants: { create: { userId: me.id, side: 0 } },
            rounds: { create: Array.from({ length: setup.roundCount }, (_, index) => ({ index })) },
          },
          select: { id: true },
        });
        const battle = (await lockBattle(tx, created.id))!;
        await writeLineup(tx, { id: created.id, type: setup.type, roundCount: setup.roundCount, theme: setup.theme }, battle.participants[0]!, lineup, name, at);

        let state = toState(battle);
        state = lockLineup(state, 0, at);
        state = send(state, at);
        await persist(tx, battle, state, [{ from: "DRAFT", to: "CHALLENGE_SENT", at }], me.id);
        if (invitedUserId) {
          await tx.notification.create({
            data: { recipientId: invitedUserId, actorId: me.id, type: "CHALLENGE_RECEIVED", battleId: created.id },
          });
        }
        return { id: created.id };
      });
    },

    /** For Find Opponent: someone else's open challenge with the same shape, oldest first. */
    async findMatch(
      actor: Actor | null,
      want: { theme: string; type: BattleSetup["type"]; roundCount: number },
    ): Promise<{ id: string } | null> {
      authorize(can(actor, { type: "battle.create" }));
      return prisma.battle.findFirst({
        where: {
          status: "CHALLENGE_SENT",
          mode: { in: ["OPEN", "MATCHMAKING"] },
          visibility: "PUBLIC",
          creatorId: { not: actor!.id },
          type: want.type,
          roundCount: want.roundCount,
          theme: { equals: want.theme, mode: "insensitive" },
          expiresAt: { gt: now() },
        },
        orderBy: { sentAt: "asc" },
        select: { id: true },
      });
    },

    async accept(actor: Actor | null, battleId: string): Promise<void> {
      await mutate(battleId, actor?.id ?? null, async ({ tx, battle, state, at }) => {
        authorize(can(actor, { type: "battle.accept", target: { creatorId: battle.creatorId, invitedUserId: battle.invitedUserId } }));
        const next = rule(() => accept(state, at));
        await tx.battleParticipant.create({ data: { battleId, userId: actor!.id, side: 1 } });
        await tx.notification.create({
          data: { recipientId: battle.creatorId, actorId: actor!.id, type: "CHALLENGE_ACCEPTED", battleId },
        });
        if (battle.mode !== "DIRECT") await grantBadge(tx, actor!.id, "OPEN_DOOR", battleId);
        return { state: next, transitions: [{ from: state.status, to: next.status, at }], result: undefined };
      });
    },

    /** The opponent locks their picks. The battle is then scheduled, and goes live right away unless a premiere was set. */
    async submitLineup(actor: Actor | null, battleId: string, rawLineup: unknown): Promise<void> {
      if (!actor) throw new AppError("UNAUTHORIZED", "Sign in first.");
      const battle = await prisma.battle.findUnique({
        where: { id: battleId },
        select: {
          type: true,
          roundCount: true,
          playlistLength: true,
          eraFrom: true,
          eraTo: true,
          participants: { where: { userId: actor.id }, select: { side: true } },
        },
      });
      if (!battle) throw new AppError("NOT_FOUND", "That battle doesn't exist.");
      if (battle.participants[0]?.side !== 1) throw new AppError("FORBIDDEN", "Only the opponent can lock in picks now.");
      const lineup = await prepareLineup(actor.id, battle, rawLineup);
      const name = await profileName(actor.id);

      await mutate(battleId, actor.id, async ({ tx, battle: locked, state, at }) => {
        const scheduled = rule(() => lockLineup(state, 1, at));
        const me = locked.participants.find((p) => p.userId === actor.id)!;
        await writeLineup(tx, { id: battleId, type: locked.type, roundCount: locked.roundCount, theme: locked.theme }, me, lineup, name, at);
        const live = advance(scheduled, at);
        return {
          state: live.state,
          transitions: [{ from: state.status, to: "SCHEDULED", at }, ...live.transitions],
          result: undefined,
        };
      });
    },

    /** Creator withdraws, invited opponent declines, or a moderator calls it off. */
    async cancel(actor: Actor | null, battleId: string): Promise<void> {
      await mutate(battleId, actor?.id ?? null, async ({ tx, battle, state, at }) => {
        authorize(can(actor, { type: "battle.cancel", target: { creatorId: battle.creatorId, invitedUserId: battle.invitedUserId } }));
        const opponent = battle.participants.find((p) => p.side === 1)?.userId;
        const reason =
          actor!.id === battle.creatorId
            ? "WITHDRAWN"
            : actor!.id === battle.invitedUserId || actor!.id === opponent
              ? "DECLINED"
              : "MODERATED";
        const next = rule(() => cancel(state, reason, at));
        if (reason === "DECLINED") {
          await tx.notification.create({ data: { recipientId: battle.creatorId, actorId: actor!.id, type: "CHALLENGE_DECLINED", battleId } });
        }
        return { state: next, transitions: [{ from: state.status, to: "CANCELLED", at }], result: undefined };
      });
    },

    /** Records listening progress on one side of a round. Returns credited and required milliseconds. */
    async reportListen(
      actor: Actor | null,
      input: { submissionId: string; playedMs: number },
    ): Promise<{ playedMs: number; requiredMs: number }> {
      if (!actor) throw new AppError("UNAUTHORIZED", "Sign in to vote.");
      const sub = await prisma.battleSubmission.findUnique({
        where: { id: input.submissionId },
        select: {
          battleId: true,
          round: { select: { index: true } },
          battle: { select: { status: true, startsAt: true, revealIntervalMs: true, roundCount: true, votingEndsAt: true } },
        },
      });
      const at = now();
      const b = sub?.battle;
      const open =
        b &&
        (b.status === "ACTIVE" || b.status === "VOTING") &&
        b.votingEndsAt !== null &&
        at < b.votingEndsAt &&
        sub.round.index < revealedRounds({ ...stateStub, status: b.status, startsAt: b.startsAt, revealIntervalMs: b.revealIntervalMs, roundCount: b.roundCount }, at);
      if (!sub || !open) throw new AppError("NOT_FOUND", "This round isn't open for voting.");
      const requiredMs = requiredListenMs(null);

      const mine = await prisma.listenProgress.findMany({
        where: { battleId: sub.battleId, userId: actor.id },
        select: { id: true, submissionId: true, startedAt: true, playedMs: true },
      });
      const existing = mine.find((l) => l.submissionId === input.submissionId);
      if (!existing) {
        // The first report starts the clock; nothing is credited yet.
        await prisma.listenProgress
          .create({ data: { battleId: sub.battleId, submissionId: input.submissionId, userId: actor.id, startedAt: at } })
          .catch((err) => {
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
          });
        return { playedMs: 0, requiredMs };
      }
      const others = mine.filter((l) => l.id !== existing.id);
      const playedMs = creditListen({
        previousMs: existing.playedMs,
        reportedMs: Number.isFinite(input.playedMs) ? input.playedMs : 0,
        startedAt: existing.startedAt,
        otherCreditMs: others.reduce((n, l) => n + l.playedMs, 0),
        battleStartedAt: mine.reduce((d, l) => (l.startedAt < d ? l.startedAt : d), existing.startedAt),
        now: at,
      });
      if (playedMs !== existing.playedMs) {
        await prisma.listenProgress.update({ where: { id: existing.id }, data: { playedMs } });
      }
      return { playedMs, requiredMs };
    },

    /**
     * One vote per person per round, validated entirely on the server: the
     * round must be open, the voter can't be a player, must have heard both
     * sides, and the database enforces uniqueness.
     */
    async vote(
      actor: Actor | null,
      input: { battleId: string; roundIndex: number; selection: Side },
    ): Promise<{ votes: [number, number] }> {
      authorize(can(actor, { type: "vote.cast" }));
      const me = actor!;
      return mutate(input.battleId, me.id, async ({ tx, battle, state, at }) => {
        if (battle.participants.some((p) => p.userId === me.id)) {
          throw new AppError("FORBIDDEN", "Players can't vote in their own battle.");
        }
        rule(() => assertRoundVotable(state, input.roundIndex, at));
        const round = await tx.battleRound.findUniqueOrThrow({
          where: { battleId_index: { battleId: input.battleId, index: input.roundIndex } },
          select: { id: true, submissions: { select: { id: true, listens: { where: { userId: me.id }, select: { playedMs: true } } } } },
        });
        const heardBoth =
          round.submissions.length === 2 && round.submissions.every((s) => (s.listens[0]?.playedMs ?? 0) >= requiredListenMs(null));
        if (!heardBoth) throw new AppError("FORBIDDEN", "Listen to both sides before you vote.");

        // Every vote takes the battle lock, so this check can't race another vote.
        const already = await tx.vote.findUnique({ where: { roundId_voterId: { roundId: round.id, voterId: me.id } }, select: { id: true } });
        if (already) throw new AppError("CONFLICT", "You've already voted on this round.");
        await tx.vote.create({ data: { battleId: input.battleId, roundId: round.id, voterId: me.id, selection: input.selection } });

        await awardXP(tx, me.id, "VOTE", round.id);
        const cast = await tx.vote.count({ where: { voterId: me.id } });
        if (cast >= 25) await grantBadge(tx, me.id, "TASTEMAKER", null);

        const counts = await tx.vote.groupBy({ by: ["selection"], where: { roundId: round.id }, _count: { _all: true } });
        const votes: [number, number] = [0, 0];
        for (const c of counts) votes[c.selection as Side] = c._count._all;
        return { state, result: { votes } };
      });
    },
  };
}

export type BattleService = ReturnType<typeof battleService>;

/** Fields `revealedRounds` doesn't read, for building a partial state. */
const stateStub = newDraft({ type: "SONG_FOR_SONG", roundCount: 1, votingDurationMs: 1, revealIntervalMs: 0, scheduledFor: null });
