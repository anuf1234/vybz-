import {
  type BattleAggregate,
  type BattleFeed,
  type BattleListItem,
  type BattleView,
  type CreateBattleRequest,
  type EngineContext,
  type EngineResult,
  EngineError,
  type ListenRequest,
  type ProfileView,
  type RankingEntry,
  type UserSummary,
  type ViewerAction,
  acceptBattle as engineAccept,
  counterOffer,
  entryOrder,
  type BattleRules,
  themeLabel,
  usesAiJudge,
  advance,
  cancelBattle as engineCancel,
  checkVote,
  createBattle as engineCreate,
  currentRound,
  declineBattle as engineDecline,
  participantFor,
  parseRules,
  plausiblePlayedMs,
  requiredListenMs,
  submitTrack,
} from "@vybz/core";
import { type Database, type Executor, newId, schema, and, desc, eq, inArray, isNotNull, lte, ne, or, sql } from "@vybz/db";
import { type PlaybackTier, resolvePlayback } from "@vybz/providers";
import type { AiJudge, JudgeInput } from "../ai-judge";
import { z } from "zod";
import { type CatalogDeps, CatalogError, NO_CAPS, type PlaybackCaps, type StoredTrack, ensureTrack, guestViewer, refsForTracks, viewerContext } from "../catalog";
import { ConflictError, insertBattle, loadBattle, saveBattle } from "./repo";
import { voterFacts } from "./eligibility";
import { buildBattleView, type ViewData } from "./view";

export interface BattleDeps {
  db: Database;
  catalog: CatalogDeps;
  /** Deployment-wide: battling needs a verified email. */
  requireVerifiedEmail: boolean;
  /** Null when no AI judge is configured: AI judging modes are then unavailable. */
  aiJudge: AiJudge | null;
  now?: () => Date;
}

export type UserRow = typeof schema.user.$inferSelect;

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ServiceError";
  }
}

const notFound = () => new ServiceError(404, "NOT_FOUND", "Battle not found");

const now = (deps: BattleDeps) => deps.now?.() ?? new Date();
const ctx = (deps: BattleDeps): EngineContext => ({ now: now(deps), newId });

export const CreateBattleSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    theme: z.string().trim().max(80).optional(),
    opponentHandle: z.string().trim().toLowerCase().max(20).optional(),
    rules: z.unknown().optional(),
  })
  .strict();

function validRules(deps: BattleDeps, input: unknown): BattleRules {
  let rules: BattleRules;
  try {
    rules = parseRules(input ?? {});
  } catch (err) {
    throw new ServiceError(400, "INVALID_RULES", err instanceof z.ZodError ? z.prettifyError(err) : String(err));
  }
  if (usesAiJudge(rules.judging.mode) && !deps.aiJudge) {
    throw new ServiceError(409, "AI_JUDGE_UNAVAILABLE", "AI judging isn't set up on this server.");
  }
  return rules;
}

// ── Transitions ────────────────────────────────────────────────────────────

/**
 * Runs an engine step inside a transaction holding the battle row lock. Any
 * due time-based transitions are applied first, so the step sees current state.
 */
async function transition(
  deps: BattleDeps,
  id: string,
  step: (agg: BattleAggregate, c: EngineContext) => EngineResult,
): Promise<EngineResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.db.transaction(async (tx) => {
        const loaded = await loadBattle(tx, id, "update");
        if (!loaded) throw notFound();
        const c = ctx(deps);
        const advanced = advance(loaded.aggregate, c);
        const result = step(advanced.battle, c);
        const events = [...advanced.events, ...result.events];
        if (events.length || result.battle !== advanced.battle) await saveBattle(tx, loaded.aggregate, result.battle);
        return { battle: result.battle, events };
      });
    } catch (err) {
      if (err instanceof ConflictError && attempt < 2) continue;
      throw mapError(err);
    }
  }
}

function mapError(err: unknown): unknown {
  if (err instanceof EngineError) {
    const status = err.code === "NOT_PARTICIPANT" || err.code === "NOT_CREATOR" || err.code === "NOT_INVITED" ? 403 : 409;
    return new ServiceError(status, err.code, err.message);
  }
  return err;
}

/** Applies due transitions if the battle has a deadline in the past. Cheap when nothing is due. */
export async function advanceIfDue(deps: BattleDeps, id: string): Promise<void> {
  const [row] = await deps.db
    .select({ due: schema.battle.nextDeadlineAt })
    .from(schema.battle)
    .where(eq(schema.battle.id, id));
  if (!row?.due || row.due > now(deps)) return;
  await transition(deps, id, (agg) => ({ battle: agg, events: [] }));
}

/** For the scheduler: advance every battle with a passed deadline. */
export async function advanceAllDue(deps: BattleDeps, limit = 200): Promise<number> {
  const due = await deps.db
    .select({ id: schema.battle.id })
    .from(schema.battle)
    .where(and(isNotNull(schema.battle.nextDeadlineAt), lte(schema.battle.nextDeadlineAt, now(deps))))
    .orderBy(schema.battle.nextDeadlineAt)
    .limit(limit);
  for (const { id } of due) {
    try {
      await advanceIfDue(deps, id);
    } catch (err) {
      console.error("advance failed", id, err);
    }
  }
  return due.length;
}

function requireBattler(deps: BattleDeps, actor: UserRow | null): UserRow {
  if (!actor) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (actor.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  if (deps.requireVerifiedEmail && !actor.emailVerified) throw new ServiceError(403, "EMAIL_NOT_VERIFIED", "Verify your email to battle.");
  return actor;
}

export async function createBattle(deps: BattleDeps, actorIn: UserRow | null, body: unknown): Promise<{ id: string }> {
  const actor = requireBattler(deps, actorIn);
  const parsed = CreateBattleSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  const req: CreateBattleRequest = parsed.data as CreateBattleRequest;

  const rulesResult = validRules(deps, req.rules);

  let invitedUserId: string | null = null;
  if (req.opponentHandle) {
    const [opp] = await deps.db.select().from(schema.user).where(eq(schema.user.handle, req.opponentHandle));
    if (!opp || opp.status !== "ACTIVE") throw new ServiceError(404, "OPPONENT_NOT_FOUND", `No one called @${req.opponentHandle}`);
    if (opp.id === actor.id) throw new ServiceError(409, "OWN_BATTLE", "You can't challenge yourself.");
    invitedUserId = opp.id;
  }

  const { battle } = engineCreate({ creatorId: actor.id, invitedUserId, rules: rulesResult }, ctx(deps));
  const theme = req.theme?.trim() || themeLabel(rulesResult.constraints);
  await deps.db.transaction((tx) => insertBattle(tx, battle, { title: req.title, theme }));
  return { id: battle.id };
}

/** Propose different terms; the other side then accepts or counters. */
export async function counterBattle(deps: BattleDeps, actorIn: UserRow | null, id: string, body: unknown) {
  const actor = requireBattler(deps, actorIn);
  const rules = validRules(deps, (body as { rules?: unknown } | null)?.rules);
  await transition(deps, id, (agg, c) => counterOffer(agg, actor.id, rules, c));
  // Keep the theme label in step with the new genre/era terms.
  const label = themeLabel(rules.constraints);
  await deps.db.update(schema.battle).set({ theme: label }).where(eq(schema.battle.id, id));
}

export async function acceptBattle(deps: BattleDeps, actor: UserRow | null, id: string) {
  const user = requireBattler(deps, actor);
  await transition(deps, id, (agg, c) => engineAccept(agg, user.id, c));
}

export async function declineBattle(deps: BattleDeps, actor: UserRow | null, id: string) {
  if (!actor) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  await transition(deps, id, (agg) => engineDecline(agg, actor.id));
}

export async function cancelBattle(deps: BattleDeps, actor: UserRow | null, id: string) {
  if (!actor) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  await transition(deps, id, (agg, c) => engineCancel(agg, actor.id, c));
}

export async function submitPick(deps: BattleDeps, actorIn: UserRow | null, id: string, roundIndex: number, body: unknown) {
  const actor = requireBattler(deps, actorIn);
  const b = (body ?? {}) as { catalogIds?: unknown; catalogId?: unknown };
  const catalogIds = Array.isArray(b.catalogIds) ? b.catalogIds : typeof b.catalogId === "string" ? [b.catalogId] : null;
  if (!catalogIds || !catalogIds.length || catalogIds.length > 3 || !catalogIds.every((c): c is string => typeof c === "string")) {
    throw new ServiceError(400, "INVALID_REQUEST", "catalogIds must list 1–3 tracks");
  }

  // Cheap checks before any provider calls.
  const loaded = await loadBattle(deps.db, id);
  if (!loaded) throw notFound();
  if (!participantFor(loaded.aggregate, actor.id)) throw new ServiceError(403, "NOT_PARTICIPANT");
  if (catalogIds.length !== loaded.aggregate.rules.tracksPerRound) {
    throw new ServiceError(409, "WRONG_TRACK_COUNT", `This battle plays ${loaded.aggregate.rules.tracksPerRound} track(s) per round.`);
  }

  // Provider lookups happen outside the locked transaction.
  const stored: StoredTrack[] = [];
  for (const catalogId of catalogIds) {
    const t = await ensureTrack(deps.db, deps.catalog, catalogId).catch((err: unknown) => {
      if (err instanceof CatalogError) {
        throw new ServiceError(err.code === "TRACK_NOT_FOUND" ? 404 : err.code === "PROVIDER_UNAVAILABLE" ? 503 : 400, err.code);
      }
      throw err;
    });
    // Every battle must work for listeners with no connected accounts.
    const guestSources = resolvePlayback(t.refs, guestViewer(deps.catalog.storefront), deps.catalog.playback);
    if (!guestSources.some((s) => s.tier !== "LINK_OUT")) {
      throw new ServiceError(409, "TRACK_NOT_PLAYABLE", `"${t.track.title}" can't be played for everyone. Pick another version.`);
    }
    stored.push(t);
  }

  try {
    await transition(deps, id, (agg, c) =>
      submitTrack(
        agg,
        {
          userId: actor.id,
          roundIndex,
          tracks: stored.map((t) => ({ id: t.track.id, releaseYear: t.track.releaseYear, durationMs: t.track.durationMs, genres: t.track.genres })),
        },
        c,
      ),
    );
  } catch (err) {
    // The (battle, track) unique index backs up the engine's check under races.
    if (isUniqueViolation(err)) throw new ServiceError(409, "TRACK_ALREADY_USED");
    throw err;
  }
}

// ── AI judge ───────────────────────────────────────────────────────────────

/**
 * Gets the AI judge's verdict for the open voting round if the battle uses the
 * AI and it hasn't ruled yet. Idempotent and safe to call from anywhere; the
 * verdict stays hidden until the round is scored.
 */
export async function ensureAiVerdicts(deps: BattleDeps, id: string): Promise<boolean> {
  if (!deps.aiJudge) return false;
  const loaded = await loadBattle(deps.db, id);
  if (!loaded) return false;
  const { aggregate: agg, row } = loaded;
  if (!usesAiJudge(agg.rules.judging.mode)) return false;
  const round = currentRound(agg);
  if (!round || round.status !== "VOTING_OPEN" || agg.aiVerdicts[round.id]) return false;

  const subs = agg.submissions.filter((s) => s.roundId === round.id);
  const tracks = await deps.db.select().from(schema.track).where(inArray(schema.track.id, subs.map((s) => s.trackId)));
  // Always blind for the AI: A/B in the round's random order, no identities.
  const order = entryOrder(round.id, true);
  const labels = ["A", "B"] as const;
  const sideParticipant = order.map((side) => agg.participants.find((p) => p.side === side)!.id);
  const input: JudgeInput = {
    battleTitle: row.title,
    theme: row.theme,
    genres: agg.rules.constraints?.genres ?? [],
    eraFrom: agg.rules.constraints?.eraFrom,
    eraTo: agg.rules.constraints?.eraTo,
    roundNumber: round.index + 1,
    suddenDeath: round.suddenDeath,
    sides: sideParticipant.map((pid, i) => ({
      label: labels[i]!,
      tracks: subs
        .filter((s) => s.participantId === pid)
        .sort((a, b) => a.position - b.position)
        .map((s) => {
          const t = tracks.find((x) => x.id === s.trackId)!;
          return { title: t.title, artistName: t.artistName, albumName: t.albumName, releaseYear: t.releaseYear, genres: t.genres, durationMs: t.durationMs };
        }),
    })),
  };

  try {
    const verdict = await deps.aiJudge.judge(input);
    const winner = sideParticipant[verdict.winner === "A" ? 0 : 1]!;
    await deps.db
      .insert(schema.aiVerdict)
      .values({ roundId: round.id, battleId: agg.id, winnerParticipantId: winner, confidence: verdict.confidence, reason: verdict.reason, model: verdict.model })
      .onConflictDoNothing();
    return true;
  } catch (err) {
    // Retried on the next view or scheduler tick; AI-only rounds extend until it rules.
    console.error("AI judge failed", id, err);
    return false;
  }
}

/** For the scheduler: rule on every open AI-judged round that's still waiting. */
export async function ensureAllAiVerdicts(deps: BattleDeps, limit = 50): Promise<number> {
  if (!deps.aiJudge) return 0;
  const pending = await deps.db
    .select({ id: schema.battleRound.battleId })
    .from(schema.battleRound)
    .innerJoin(schema.battle, eq(schema.battle.id, schema.battleRound.battleId))
    .where(
      and(
        eq(schema.battleRound.status, "VOTING_OPEN"),
        sql`${schema.battle.rules}->'judging'->>'mode' in ('AI','COMBINED','SEPARATE')`,
        sql`not exists (select 1 from ${schema.aiVerdict} where ${schema.aiVerdict.roundId} = ${schema.battleRound.id})`,
      ),
    )
    .limit(limit);
  let n = 0;
  for (const { id } of pending) if (await ensureAiVerdicts(deps, id)) n++;
  return n;
}

// ── Listening and voting ───────────────────────────────────────────────────

const ListenSchema = z
  .object({
    submissionId: z.string().min(1).max(40),
    playedMs: z.number().int().min(0).max(60 * 60_000),
    tier: z.enum(["HOSTED_FULL", "PROVIDER_FULL", "EMBED", "PREVIEW", "LINK_OUT"]),
  })
  .strict();

export async function recordListen(deps: BattleDeps, actor: UserRow | null, id: string, roundIndex: number, body: unknown, caps: PlaybackCaps = NO_CAPS) {
  if (!actor) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  const parsed = ListenSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  const req: ListenRequest = parsed.data;
  if (req.tier === "LINK_OUT") throw new ServiceError(400, "INVALID_TIER");

  await advanceIfDue(deps, id);
  return deps.db.transaction(async (tx) => {
    const loaded = await loadBattle(tx, id, "share");
    if (!loaded) throw notFound();
    const round = currentRound(loaded.aggregate);
    if (!round || round.index !== roundIndex || round.status !== "VOTING_OPEN") throw new ServiceError(409, "VOTING_CLOSED");
    const sub = loaded.aggregate.submissions.find((s) => s.id === req.submissionId && s.roundId === round.id);
    if (!sub) throw new ServiceError(404, "UNKNOWN_SUBMISSION");

    // The reported tier must be one this viewer can actually get for this track.
    const refs = (await refsForTracks(tx, [sub.trackId])).get(sub.trackId) ?? [];
    const tiers = new Set(resolvePlayback(refs, viewerContext(deps.catalog.storefront, caps, actor.id), deps.catalog.playback).map((s) => s.tier));
    if (!tiers.has(req.tier)) throw new ServiceError(400, "INVALID_TIER");

    const t = now(deps);
    const [existing] = await tx
      .select()
      .from(schema.listenProof)
      .where(and(eq(schema.listenProof.roundId, round.id), eq(schema.listenProof.userId, actor.id), eq(schema.listenProof.submissionId, sub.id)));

    // Switching tier restarts the clock: proofs only count at one tier.
    const restart = !existing || existing.tier !== req.tier;
    const startedAt = restart ? t : existing.startedAt;
    const playedMs = plausiblePlayedMs(startedAt, t, restart ? 0 : existing.playedMs, req.playedMs);

    await tx
      .insert(schema.listenProof)
      .values({ id: newId(), roundId: round.id, userId: actor.id, submissionId: sub.id, tier: req.tier, playedMs, startedAt })
      .onConflictDoUpdate({
        target: [schema.listenProof.roundId, schema.listenProof.userId, schema.listenProof.submissionId],
        set: { tier: req.tier, playedMs, startedAt, updatedAt: t },
      });

    const [track] = await tx.select({ durationMs: schema.track.durationMs }).from(schema.track).where(eq(schema.track.id, sub.trackId));
    return { playedMs, requiredMs: requiredListenMs(loaded.aggregate.rules.fairListen.minPlayedMs, track?.durationMs, req.tier) };
  });
}


export async function castVote(deps: BattleDeps, actor: UserRow | null, id: string, roundIndex: number, submissionId: unknown) {
  if (typeof submissionId !== "string") throw new ServiceError(400, "INVALID_REQUEST", "submissionId is required");
  await advanceIfDue(deps, id);
  try {
    await deps.db.transaction(async (tx) => {
      const loaded = await loadBattle(tx, id, "share");
      if (!loaded) throw notFound();
      const agg = loaded.aggregate;
      const round = agg.rounds.find((r) => r.index === roundIndex);
      const roundId = round?.id ?? "";
      const [proofs, voted, durations] = await Promise.all([
        actor ? tx.select().from(schema.listenProof).where(and(eq(schema.listenProof.roundId, roundId), eq(schema.listenProof.userId, actor.id))) : [],
        actor ? tx.select({ id: schema.vote.id }).from(schema.vote).where(and(eq(schema.vote.roundId, roundId), eq(schema.vote.voterId, actor.id))) : [],
        tx
          .select({ submissionId: schema.submission.id, durationMs: schema.track.durationMs })
          .from(schema.submission)
          .innerJoin(schema.track, eq(schema.track.id, schema.submission.trackId))
          .where(eq(schema.submission.roundId, roundId)),
      ]);
      const reason = checkVote({
        battle: agg,
        roundIndex,
        voter: voterFacts(actor, deps.requireVerifiedEmail),
        submissionId,
        alreadyVoted: voted.length > 0,
        proofs: proofs.map((p) => ({ submissionId: p.submissionId, playedMs: p.playedMs, tier: p.tier as PlaybackTier })),
        submissions: durations,
        now: now(deps),
      });
      if (reason) throw new ServiceError(reason === "SIGN_IN_REQUIRED" ? 401 : reason === "VOTING_CLOSED" || reason === "ALREADY_VOTED" ? 409 : 403, reason);

      const sub = agg.submissions.find((s) => s.id === submissionId)!;
      await tx.insert(schema.vote).values({
        id: newId(),
        battleId: agg.id,
        roundId,
        voterId: actor!.id,
        submissionId,
        participantId: sub.participantId,
        tier: proofs[0]!.tier,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError(409, "ALREADY_VOTED");
    throw err;
  }
}

export async function rematch(deps: BattleDeps, actorIn: UserRow | null, id: string): Promise<{ id: string }> {
  const actor = requireBattler(deps, actorIn);
  const loaded = await loadBattle(deps.db, id);
  if (!loaded) throw notFound();
  const { aggregate: agg, row } = loaded;
  if (agg.status !== "COMPLETE") throw new ServiceError(409, "NOT_COMPLETE");
  const me = participantFor(agg, actor.id);
  if (!me) throw new ServiceError(403, "NOT_PARTICIPANT");
  const opponent = agg.participants.find((p) => p.id !== me.id)!;
  const { battle } = engineCreate({ creatorId: actor.id, invitedUserId: opponent.userId, rules: agg.rules }, ctx(deps));
  await deps.db.transaction((tx) =>
    insertBattle(tx, battle, { title: row.title.startsWith("Rematch: ") ? row.title : `Rematch: ${row.title}`.slice(0, 80), theme: row.theme, rematchOfId: row.id }),
  );
  return { id: battle.id };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getBattleView(deps: BattleDeps, viewer: UserRow | null, id: string, caps: PlaybackCaps = NO_CAPS): Promise<BattleView> {
  await advanceIfDue(deps, id);
  const loaded = await loadBattle(deps.db, id);
  if (!loaded) throw notFound();
  const { aggregate: agg, row } = loaded;

  const userIds = [...new Set([agg.creatorId, agg.invitedUserId, ...agg.participants.map((p) => p.userId)].filter((x): x is string => !!x))];
  const trackIds = [...new Set(agg.submissions.map((s) => s.trackId))];
  const roundIds = agg.rounds.map((r) => r.id);

  const [users, tracks, refs, proofs, votes, verdicts] = await Promise.all([
    usersById(deps.db, userIds),
    trackIds.length ? deps.db.select().from(schema.track).where(inArray(schema.track.id, trackIds)) : [],
    refsForTracks(deps.db, trackIds),
    viewer && roundIds.length
      ? deps.db.select().from(schema.listenProof).where(and(eq(schema.listenProof.userId, viewer.id), inArray(schema.listenProof.roundId, roundIds)))
      : [],
    viewer
      ? deps.db.select({ roundId: schema.vote.roundId, submissionId: schema.vote.submissionId }).from(schema.vote).where(and(eq(schema.vote.battleId, id), eq(schema.vote.voterId, viewer.id)))
      : [],
    deps.db.select().from(schema.aiVerdict).where(eq(schema.aiVerdict.battleId, id)),
  ]);

  const data: ViewData = {
    agg,
    row,
    users,
    tracks: new Map(tracks.map((t) => [t.id, t])),
    refs,
    proofs: proofs.map((p) => ({ roundId: p.roundId, submissionId: p.submissionId, playedMs: p.playedMs, tier: p.tier as PlaybackTier })),
    votes,
    verdicts,
    viewer,
    deploymentVerifiesEmail: deps.requireVerifiedEmail,
    now: now(deps),
    caps,
    playback: deps.catalog.playback,
    storefront: deps.catalog.storefront,
  };
  return buildBattleView(data);
}

export async function usersById(db: Executor, ids: string[]): Promise<Map<string, UserSummary>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: schema.user.id, handle: schema.user.handle, displayName: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(inArray(schema.user.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function listBattles(deps: BattleDeps, viewer: UserRow | null, feed: BattleFeed, limit = 30): Promise<BattleListItem[]> {
  const b = schema.battle;
  const p = schema.battleParticipant;
  let where;
  switch (feed) {
    case "open":
      where = and(eq(b.status, "OPEN_CHALLENGE"), viewer ? ne(b.creatorId, viewer.id) : undefined);
      break;
    case "mine":
      if (!viewer) return [];
      where = or(
        eq(b.creatorId, viewer.id),
        eq(b.invitedUserId, viewer.id),
        inArray(b.id, deps.db.select({ id: p.battleId }).from(p).where(eq(p.userId, viewer.id))),
      );
      break;
    case "vote":
      where = and(
        eq(b.status, "IN_PROGRESS"),
        sql`coalesce(${b.rules}->'judging'->>'mode', 'CROWD') <> 'AI'`,
        inArray(b.id, deps.db.select({ id: schema.battleRound.battleId }).from(schema.battleRound).where(eq(schema.battleRound.status, "VOTING_OPEN"))),
        viewer ? sql`not exists (select 1 from ${p} where ${p.battleId} = ${b.id} and ${p.userId} = ${viewer.id})` : undefined,
      );
      break;
    default:
      where = inArray(b.status, ["IN_PROGRESS", "COMPLETE", "OPEN_CHALLENGE"]);
  }

  const rows = await deps.db.select().from(b).where(where).orderBy(desc(b.updatedAt)).limit(limit);
  const items = await toListItems(deps, viewer, rows);
  if (feed === "vote") return items.filter((i) => i.viewerAction === "vote");
  if (feed === "mine") {
    const rank: Record<ViewerAction, number> = { accept: 0, submit: 1, vote: 2, wait: 3, none: 4 };
    return [...items].sort((x, y) => rank[x.viewerAction] - rank[y.viewerAction]);
  }
  return items;
}

async function toListItems(deps: BattleDeps, viewer: UserRow | null, rows: (typeof schema.battle.$inferSelect)[]): Promise<BattleListItem[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [parts, rounds, mySubs, myVotes] = await Promise.all([
    deps.db.select().from(schema.battleParticipant).where(inArray(schema.battleParticipant.battleId, ids)),
    deps.db.select().from(schema.battleRound).where(inArray(schema.battleRound.battleId, ids)),
    viewer
      ? deps.db
          .select({ roundId: schema.submission.roundId })
          .from(schema.submission)
          .innerJoin(schema.battleParticipant, eq(schema.battleParticipant.id, schema.submission.participantId))
          .where(and(inArray(schema.submission.battleId, ids), eq(schema.battleParticipant.userId, viewer.id)))
      : [],
    viewer ? deps.db.select({ roundId: schema.vote.roundId }).from(schema.vote).where(and(inArray(schema.vote.battleId, ids), eq(schema.vote.voterId, viewer.id))) : [],
  ]);
  const users = await usersById(deps.db, [...new Set([...rows.flatMap((r) => [r.creatorId, r.invitedUserId]), ...parts.map((x) => x.userId)].filter((x): x is string => !!x))]);
  const submitted = new Set(mySubs.map((s) => s.roundId));
  const voted = new Set(myVotes.map((v) => v.roundId));
  const t = now(deps);

  return rows.map((r) => {
    const ps = parts.filter((x) => x.battleId === r.id).sort((a, c) => a.side - c.side);
    const rs = rounds.filter((x) => x.battleId === r.id).sort((a, c) => a.index - c.index);
    const cur = r.status === "IN_PROGRESS" ? rs.find((x) => x.status === "SUBMISSIONS_OPEN" || x.status === "VOTING_OPEN") ?? null : null;
    const isParticipant = viewer ? ps.some((x) => x.userId === viewer.id) : false;

    let action: ViewerAction = "none";
    if (viewer) {
      const acceptOpen = !r.acceptDeadline || r.acceptDeadline > t;
      const proposer = r.proposedById ?? r.creatorId;
      const awaiting = r.status === "PENDING_ACCEPT" ? (proposer === r.creatorId ? r.invitedUserId : r.creatorId) : null;
      const aiOnly = (r.rules as { judging?: { mode?: string } }).judging?.mode === "AI";
      if (r.status === "PENDING_ACCEPT" && awaiting === viewer.id && acceptOpen) action = "accept";
      else if (r.status === "OPEN_CHALLENGE" && r.creatorId !== viewer.id && acceptOpen) action = "accept";
      else if (cur && isParticipant) action = cur.status === "SUBMISSIONS_OPEN" && !submitted.has(cur.id) ? "submit" : "wait";
      else if (cur && !isParticipant && cur.status === "VOTING_OPEN" && !voted.has(cur.id) && !aiOnly) action = "vote";
      else if (r.status === "OPEN_CHALLENGE" && r.creatorId === viewer.id) action = "wait";
      else if (r.status === "PENDING_ACCEPT" && (r.creatorId === viewer.id || r.invitedUserId === viewer.id)) action = "wait";
    }

    return {
      id: r.id,
      title: r.title,
      theme: r.theme,
      status: r.status,
      roundCount: r.roundCount,
      currentRoundIndex: cur?.index ?? null,
      currentRoundStatus: cur?.status ?? null,
      deadline: (r.nextDeadlineAt ?? null)?.toISOString() ?? null,
      participants: ps.map((x) => ({ id: x.id, side: x.side as 0 | 1, user: users.get(x.userId)!, roundsWon: x.roundsWon })),
      winnerParticipantId: r.winnerParticipantId,
      creator: users.get(r.creatorId)!,
      invited: r.invitedUserId ? (users.get(r.invitedUserId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      viewerAction: action,
    };
  });
}

export async function rankings(deps: BattleDeps, limit = 50): Promise<RankingEntry[]> {
  const p = schema.battleParticipant;
  const b = schema.battle;
  const rows = await deps.db
    .select({
      userId: p.userId,
      wins: sql<number>`count(*) filter (where ${b.winnerParticipantId} = ${p.id})::int`,
      draws: sql<number>`count(*) filter (where ${b.winnerParticipantId} is null)::int`,
      losses: sql<number>`count(*) filter (where ${b.winnerParticipantId} is not null and ${b.winnerParticipantId} <> ${p.id})::int`,
      roundsWon: sql<number>`coalesce(sum(${p.roundsWon}), 0)::int`,
    })
    .from(p)
    .innerJoin(b, eq(b.id, p.battleId))
    .where(eq(b.status, "COMPLETE"))
    .groupBy(p.userId)
    .orderBy(sql`2 desc`, sql`5 desc`, sql`4 asc`)
    .limit(limit);
  const users = await usersById(deps.db, rows.map((r) => r.userId));
  return rows.map((r, i) => ({ rank: i + 1, user: users.get(r.userId)!, wins: r.wins, losses: r.losses, draws: r.draws, roundsWon: r.roundsWon }));
}

export async function profile(deps: BattleDeps, viewer: UserRow | null, handle: string): Promise<ProfileView> {
  const [u] = await deps.db.select().from(schema.user).where(eq(schema.user.handle, handle.toLowerCase()));
  if (!u) throw new ServiceError(404, "NOT_FOUND", "No such user");
  const all = await rankingsFor(deps, u.id);
  const battleIds = deps.db.select({ id: schema.battleParticipant.battleId }).from(schema.battleParticipant).where(eq(schema.battleParticipant.userId, u.id));
  const rows = await deps.db.select().from(schema.battle).where(inArray(schema.battle.id, battleIds)).orderBy(desc(schema.battle.updatedAt)).limit(20);
  return {
    user: { id: u.id, handle: u.handle, displayName: u.name, image: u.image },
    record: all,
    recent: await toListItems(deps, viewer, rows),
  };
}

async function rankingsFor(deps: BattleDeps, userId: string) {
  const p = schema.battleParticipant;
  const b = schema.battle;
  const [r] = await deps.db
    .select({
      battles: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${b.status} = 'COMPLETE' and ${b.winnerParticipantId} = ${p.id})::int`,
      draws: sql<number>`count(*) filter (where ${b.status} = 'COMPLETE' and ${b.winnerParticipantId} is null)::int`,
      losses: sql<number>`count(*) filter (where ${b.status} = 'COMPLETE' and ${b.winnerParticipantId} <> ${p.id})::int`,
      roundsWon: sql<number>`coalesce(sum(${p.roundsWon}), 0)::int`,
    })
    .from(p)
    .innerJoin(b, eq(b.id, p.battleId))
    .where(and(eq(p.userId, userId), inArray(b.status, ["IN_PROGRESS", "COMPLETE"])));
  return r ?? { battles: 0, wins: 0, draws: 0, losses: 0, roundsWon: 0 };
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e === "object" && e && "code" in e && (e as { code: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

