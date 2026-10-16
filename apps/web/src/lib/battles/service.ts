/**
 * Battle use cases: authorization, validation and persistence around the pure
 * engine in @vybz/core. Framework-free (no Next.js imports) so it runs in
 * integration tests against a real database.
 *
 * Every state change locks the battle row, applies due transitions first,
 * then the requested action, then persists. Votes and picks therefore can
 * never race a deadline or each other.
 */
import {
  type Actor,
  BattleRuleError,
  type BattleModel,
  type BattleRules,
  BattleRulesSchema,
  BattleThemeSchema,
  type DenyReason,
  HandleSchema,
  type Side,
  accept,
  advance,
  assertVotingOpen,
  can,
  cancel,
  creditListen,
  fitsEra,
  newChallenge,
  requiredListenMs,
  submit,
} from "@vybz/core";
import { Prisma, type PrismaClient } from "@vybz/db";
import type { TrackCandidate, TrackProviderRef } from "@vybz/providers";
import { type BattleRow, lockBattle, nextDeadline, parseRules, persist } from "./model";

export class BattleError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "BattleError";
  }
}

/** Catalog access the service needs. Implemented by the app's provider wiring (or a stub in tests). */
export interface CatalogPort {
  getTrack(appleId: string): Promise<TrackCandidate | null>;
  /** Best-effort YouTube match for embeds; may return null or throw (quota). */
  matchYouTube?(track: TrackCandidate): Promise<TrackProviderRef | null>;
}

export interface Deps {
  prisma: PrismaClient;
  now?: () => Date;
}

const MAX_PENDING_CHALLENGES = 10;

const DENY_MESSAGES: Partial<Record<DenyReason, string>> = {
  SIGN_IN_REQUIRED: "Sign in first.",
  EMAIL_UNVERIFIED: "Confirm your email first.",
  ONBOARDING_REQUIRED: "Pick your handle first.",
  ACCOUNT_RESTRICTED: "Your account can't do this right now.",
};

function authorize(decision: ReturnType<typeof can>): void {
  if (!decision.allow) {
    throw new BattleError("FORBIDDEN", DENY_MESSAGES[decision.reason] ?? "You can't do that.");
  }
}

function fromRuleError(err: unknown): never {
  if (err instanceof BattleRuleError) throw new BattleError("CONFLICT", err.message);
  throw err;
}

export function battleService({ prisma, now = () => new Date() }: Deps) {
  /**
   * Lock, advance to `at`, apply `action`, persist. An action may return the
   * row it last wrote against when it persisted part of its work itself.
   */
  async function mutate<T>(
    battleId: string,
    action: (ctx: { tx: Prisma.TransactionClient; row: BattleRow; model: BattleModel; at: Date }) => Promise<{
      model: BattleModel;
      result: T;
      row?: BattleRow;
    }>,
  ): Promise<T> {
    const outcome = await prisma.$transaction(async (tx) => {
      const loaded = await lockBattle(tx, battleId);
      if (!loaded) throw new BattleError("NOT_FOUND", "Battle not found.");
      const at = now();
      const advanced = advance(loaded.model, at);
      try {
        const out = await action({ tx, row: loaded.row, model: advanced, at });
        await persist(tx, out.row ?? loaded.row, out.model);
        return { ok: true as const, result: out.result };
      } catch (err) {
        // A refused action still commits the transitions that were due. Actions
        // refuse before writing anything, so the transaction is still usable.
        if (err instanceof BattleRuleError || err instanceof BattleError) {
          await persist(tx, loaded.row, advanced);
          return { ok: false as const, error: err };
        }
        throw err;
      }
    });
    if (!outcome.ok) throw outcome.error instanceof BattleError ? outcome.error : fromRuleError(outcome.error);
    return outcome.result;
  }

  return {
    /** Applies any due transitions (deadlines). Safe to call on every page view. */
    async advance(battleId: string): Promise<void> {
      await mutate(battleId, async ({ model }) => ({ model, result: undefined }));
    },

    /** Sweeps battles whose next deadline has passed. For the cron route. */
    async advanceDue(limit = 50): Promise<number> {
      const due = await prisma.battle.findMany({
        where: { status: { in: ["OPEN", "PENDING_ACCEPT", "IN_PROGRESS"] }, nextDeadline: { lte: now() } },
        select: { id: true },
        orderBy: { nextDeadline: "asc" },
        take: limit,
      });
      for (const { id } of due) await this.advance(id);
      return due.length;
    },

    async create(
      actor: Actor | null,
      input: { theme: unknown; rules: unknown; opponentHandle?: unknown },
    ): Promise<{ id: string }> {
      authorize(can(actor, { type: "battle.create" }));
      const me = actor!;

      const theme = BattleThemeSchema.safeParse(input.theme);
      if (!theme.success) throw new BattleError("INVALID", theme.error.issues[0]?.message ?? "Invalid theme.");
      const rules = BattleRulesSchema.safeParse(input.rules);
      if (!rules.success) throw new BattleError("INVALID", rules.error.issues[0]?.message ?? "Invalid rules.");

      let invitedUserId: string | null = null;
      if (typeof input.opponentHandle === "string" && input.opponentHandle.trim() !== "") {
        const handle = HandleSchema.safeParse(input.opponentHandle);
        const opponent = handle.success
          ? await prisma.user.findUnique({ where: { handle: handle.data }, select: { id: true, status: true } })
          : null;
        if (!opponent || opponent.status !== "ACTIVE") throw new BattleError("INVALID", "We couldn't find that @handle.");
        if (opponent.id === me.id) throw new BattleError("INVALID", "You can't challenge yourself.");
        invitedUserId = opponent.id;
      }

      const pending = await prisma.battle.count({
        where: { creatorId: me.id, status: { in: ["OPEN", "PENDING_ACCEPT"] } },
      });
      if (pending >= MAX_PENDING_CHALLENGES) {
        throw new BattleError("CONFLICT", `You already have ${MAX_PENDING_CHALLENGES} challenges waiting for opponents.`);
      }

      return createChallenge(prisma, {
        creatorId: me.id,
        invitedUserId,
        theme: theme.data,
        rules: rules.data,
        rematchOfId: null,
        at: now(),
      });
    },

    async accept(actor: Actor | null, battleId: string): Promise<void> {
      await mutate(battleId, async ({ tx, row, model, at }) => {
        authorize(can(actor, { type: "battle.accept", target: { creatorId: row.creatorId, invitedUserId: row.invitedUserId } }));
        let next: BattleModel;
        try {
          next = accept(model, at);
        } catch (err) {
          fromRuleError(err);
        }
        await tx.battleParticipant.create({ data: { battleId, userId: actor!.id, side: 1 } });
        return { model: next, result: undefined };
      });
    },

    async cancel(actor: Actor | null, battleId: string): Promise<void> {
      await mutate(battleId, async ({ row, model, at }) => {
        authorize(can(actor, { type: "battle.cancel", target: { creatorId: row.creatorId, invitedUserId: row.invitedUserId } }));
        try {
          return { model: cancel(model, at), result: undefined };
        } catch (err) {
          fromRuleError(err);
        }
      });
    },

    /** A participant picks a track (by Apple Music catalog ID) for the current round. */
    async submitTrack(
      actor: Actor | null,
      input: { battleId: string; roundIndex: number; appleId: string },
      catalog: CatalogPort,
    ): Promise<void> {
      if (!actor) throw new BattleError("FORBIDDEN", "Sign in first.");
      const battle = await prisma.battle.findUnique({
        where: { id: input.battleId },
        select: { rules: true, participants: { where: { userId: actor.id }, select: { id: true, side: true } } },
      });
      if (!battle) throw new BattleError("NOT_FOUND", "Battle not found.");
      const participant = battle.participants[0];
      if (!participant) throw new BattleError("FORBIDDEN", "Only the two battlers can pick tracks.");

      // Metadata comes from the provider, never from the client.
      const candidate = await catalog.getTrack(input.appleId);
      if (!candidate) throw new BattleError("INVALID", "We couldn't find that track.");
      const rules = parseRules(battle.rules);
      if (!fitsEra(rules, candidate.releaseYear)) {
        throw new BattleError("INVALID", `“${candidate.title}” came out in ${candidate.releaseYear}, outside this battle's era.`);
      }

      const trackId = await upsertTrack(prisma, candidate);
      if (catalog.matchYouTube) {
        // Outside the battle lock: network calls must not hold a row lock.
        await attachYouTube(prisma, trackId, candidate, catalog.matchYouTube).catch(() => undefined);
      }

      try {
        await mutate(input.battleId, async ({ tx, row, model, at }) => {
          let next: BattleModel;
          try {
            next = submit(model, participant.side as Side, input.roundIndex, at);
          } catch (err) {
            fromRuleError(err);
          }
          // persist() creates any new round row; the submission needs the current one.
          await persist(tx, row, next);
          const round = await tx.battleRound.findUniqueOrThrow({
            where: { battleId_index: { battleId: input.battleId, index: input.roundIndex } },
            select: { id: true },
          });
          await tx.submission.create({
            data: {
              roundId: round.id,
              battleId: input.battleId,
              participantId: participant.id,
              side: participant.side,
              trackId,
            },
          });
          const reloaded = (await lockBattle(tx, input.battleId))!;
          return { model: reloaded.model, row: reloaded.row, result: undefined };
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new BattleError("CONFLICT", "That track has already been played in this battle. Pick another.");
        }
        throw err;
      }
    },

    /** Records listening progress for a submission. Returns credited and required milliseconds. */
    async reportListen(
      actor: Actor | null,
      input: { submissionId: string; playedMs: number },
    ): Promise<{ playedMs: number; requiredMs: number }> {
      if (!actor) throw new BattleError("FORBIDDEN", "Sign in to vote.");
      const sub = await prisma.submission.findUnique({
        where: { id: input.submissionId },
        select: { roundId: true, round: { select: { status: true } }, track: { select: { durationMs: true } } },
      });
      if (!sub || sub.round.status !== "VOTING_OPEN") throw new BattleError("NOT_FOUND", "This round isn't open for voting.");
      const requiredMs = requiredListenMs(sub.track.durationMs);
      const at = now();

      const existing = await prisma.listenProgress.findUnique({
        where: { submissionId_userId: { submissionId: input.submissionId, userId: actor.id } },
      });
      if (!existing) {
        // The first report starts the clock; nothing is credited yet.
        await prisma.listenProgress
          .create({ data: { roundId: sub.roundId, submissionId: input.submissionId, userId: actor.id, startedAt: at } })
          .catch((err) => {
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
          });
        return { playedMs: 0, requiredMs };
      }
      const playedMs = creditListen({
        previousMs: existing.playedMs,
        reportedMs: Number.isFinite(input.playedMs) ? input.playedMs : 0,
        startedAt: existing.startedAt,
        now: at,
      });
      if (playedMs !== existing.playedMs) {
        await prisma.listenProgress.update({ where: { id: existing.id }, data: { playedMs } });
      }
      return { playedMs, requiredMs };
    },

    /** Votes for a submission. Voters send the submission, never a side, so blind rounds stay blind. */
    async vote(actor: Actor | null, submissionId: string): Promise<void> {
      authorize(can(actor, { type: "vote.cast" }));
      const me = actor!;
      const sub = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { side: true, roundId: true, battleId: true, round: { select: { index: true } } },
      });
      if (!sub) throw new BattleError("NOT_FOUND", "That pick doesn't exist.");

      await mutate(sub.battleId, async ({ tx, row, model, at }) => {
        if (row.participants.some((p) => p.userId === me.id)) {
          throw new BattleError("FORBIDDEN", "Battlers can't vote in their own battle.");
        }
        try {
          assertVotingOpen(model, sub.round.index, at);
        } catch (err) {
          fromRuleError(err);
        }

        const pair = await tx.submission.findMany({
          where: { roundId: sub.roundId },
          select: { id: true, track: { select: { durationMs: true } }, listens: { where: { userId: me.id } } },
        });
        const heardBoth =
          pair.length === 2 && pair.every((s) => (s.listens[0]?.playedMs ?? 0) >= requiredListenMs(s.track.durationMs));
        if (!heardBoth) throw new BattleError("FORBIDDEN", "Listen to both tracks before you vote.");

        // Every vote takes the battle lock, so this check can't race another vote.
        const already = await tx.vote.findUnique({
          where: { roundId_voterId: { roundId: sub.roundId, voterId: me.id } },
          select: { id: true },
        });
        if (already) throw new BattleError("CONFLICT", "You've already voted in this round.");
        await tx.vote.create({ data: { roundId: sub.roundId, voterId: me.id, side: sub.side } });
        return { model, result: undefined };
      });
    },

    /** Same opponent, same rules, sides as before. The opponent has to accept. */
    async rematch(actor: Actor | null, battleId: string): Promise<{ id: string }> {
      authorize(can(actor, { type: "battle.create" }));
      const me = actor!;
      const battle = await prisma.battle.findUnique({
        where: { id: battleId },
        select: { status: true, theme: true, rules: true, participants: { select: { userId: true } } },
      });
      if (!battle) throw new BattleError("NOT_FOUND", "Battle not found.");
      if (battle.status !== "COMPLETE") throw new BattleError("CONFLICT", "You can ask for a rematch once the battle is over.");
      if (!battle.participants.some((p) => p.userId === me.id)) {
        throw new BattleError("FORBIDDEN", "Only the battlers can ask for a rematch.");
      }
      const opponent = battle.participants.find((p) => p.userId !== me.id)!;

      const existing = await prisma.battle.findFirst({
        where: { rematchOfId: battleId, status: { in: ["PENDING_ACCEPT", "IN_PROGRESS"] } },
        select: { id: true },
      });
      if (existing) return existing;

      return createChallenge(prisma, {
        creatorId: me.id,
        invitedUserId: opponent.userId,
        theme: battle.theme,
        rules: parseRules(battle.rules),
        rematchOfId: battleId,
        at: now(),
      });
    },
  };
}

export type BattleService = ReturnType<typeof battleService>;

async function createChallenge(
  prisma: PrismaClient,
  input: { creatorId: string; invitedUserId: string | null; theme: string; rules: BattleRules; rematchOfId: string | null; at: Date },
): Promise<{ id: string }> {
  const model = newChallenge(input.rules, input.at, input.invitedUserId !== null);
  const battle = await prisma.battle.create({
    data: {
      status: model.status,
      theme: input.theme,
      rules: input.rules,
      roundCount: input.rules.roundCount,
      creatorId: input.creatorId,
      invitedUserId: input.invitedUserId,
      rematchOfId: input.rematchOfId,
      expiresAt: model.expiresAt,
      nextDeadline: nextDeadline(model),
      createdAt: input.at,
      participants: { create: { userId: input.creatorId, side: 0 } },
    },
    select: { id: true },
  });
  return battle;
}

/** Finds or creates the canonical track for an Apple Music candidate. */
async function upsertTrack(prisma: PrismaClient, c: TrackCandidate): Promise<string> {
  const ref = await prisma.trackProviderRef.findUnique({
    where: { provider_externalId: { provider: "APPLE_MUSIC", externalId: c.externalId } },
    select: { trackId: true },
  });
  if (ref) return ref.trackId;

  const meta = {
    title: c.title,
    artistName: c.artistName,
    albumName: c.albumName ?? null,
    releaseYear: c.releaseYear ?? null,
    durationMs: c.durationMs ?? null,
    artworkUrl: c.artwork?.url ?? null,
    explicit: c.explicit ?? false,
  };
  const appleRef = {
    provider: "APPLE_MUSIC" as const,
    externalId: c.externalId,
    externalUrl: c.externalUrl ?? null,
    previewUrl: c.previewUrl ?? null,
  };

  try {
    // Same recording under a different Apple ID (another album or storefront): reuse it by ISRC.
    const byIsrc = c.isrc ? await prisma.track.findUnique({ where: { isrc: c.isrc }, select: { id: true } }) : null;
    if (byIsrc) return byIsrc.id;
    const track = await prisma.track.create({
      data: { ...meta, isrc: c.isrc ?? null, refs: { create: appleRef } },
      select: { id: true },
    });
    return track.id;
  } catch (err) {
    // Another request created it first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await prisma.trackProviderRef.findUniqueOrThrow({
        where: { provider_externalId: { provider: "APPLE_MUSIC", externalId: c.externalId } },
        select: { trackId: true },
      });
      return again.trackId;
    }
    throw err;
  }
}

async function attachYouTube(
  prisma: PrismaClient,
  trackId: string,
  candidate: TrackCandidate,
  match: NonNullable<CatalogPort["matchYouTube"]>,
): Promise<void> {
  const has = await prisma.trackProviderRef.findUnique({
    where: { trackId_provider: { trackId, provider: "YOUTUBE" } },
    select: { id: true },
  });
  if (has) return;
  const ref = await match(candidate);
  if (!ref) return;
  await prisma.trackProviderRef.create({
    data: {
      trackId,
      provider: "YOUTUBE",
      externalId: ref.externalId,
      externalUrl: ref.externalUrl ?? null,
      embeddable: ref.embeddable ?? true,
    },
  });
}
