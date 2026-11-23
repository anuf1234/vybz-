import { recordActivity } from "../vybz-streak";
import { applyRanked, rankView } from "../ranked";
import { checkAchievements } from "../achievements";
import { awardBattle, awardVote } from "../progression";
import {
  type BattleAggregate,
  type BattleFeed,
  type BattleListItem,
  type BattleStats,
  voidBattle as engineVoid,
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
  joinBattle as engineJoin,
  leaveBattle as engineLeave,
  startBattle as engineStart,
  isDuel,
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
  seasonOf,
  BATTLE_CODE_ALPHABET,
  DIVISIONS,
  LEAGUES,
  BATTLE_CODE_LENGTH,
  normalizeBattleCode,
} from "@vybz/core";
import { type Database, type Executor, newId, schema, and, desc, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from "@vybz/db";
import { type PlaybackTier, resolvePlayback } from "@vybz/providers";
import type { AiJudge, JudgeInput } from "../ai-judge";
import { z } from "zod";
import { randomInt } from "node:crypto";
import { isBlockedBetween, socialFor } from "../social";
import { type CatalogDeps, CatalogError, NO_CAPS, type PlaybackCaps, type StoredTrack, ensureTrack, ensureYouTubeMatch, guestViewer, refsForTracks, toTrackView, viewerContext } from "../catalog";
import { ConflictError, insertBattle, loadBattle, saveBattle } from "./repo";
import { voterFacts } from "./eligibility";
import { buildBattleView, type ViewData } from "./view";
import { type BattleRow, canViewBattle, isStaff, newInviteCode } from "./access";
import { type PushSender, createNotifications, notifyForEvents } from "../notifications";

export interface BattleDeps {
  db: Database;
  catalog: CatalogDeps;
  /** Deployment-wide: battling needs a verified email. */
  requireVerifiedEmail: boolean;
  /** Null when no AI judge is configured: AI judging modes are then unavailable. */
  aiJudge: AiJudge | null;
  /** Sends phone notifications; null/undefined to skip pushes (in-app notifications are still stored). */
  push?: PushSender | null;
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
    inviteHandles: z.array(z.string().trim().toLowerCase().max(21)).max(20).optional(),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
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
    let title = "";
    let result: EngineResult;
    try {
      result = await deps.db.transaction(async (tx) => {
        const loaded = await loadBattle(tx, id, "update");
        if (!loaded) throw notFound();
        title = loaded.row.title;
        const c = ctx(deps);
        const advanced = advance(loaded.aggregate, c);
        const stepped = step(advanced.battle, c);
        const events = [...advanced.events, ...stepped.events];
        if (events.length || stepped.battle !== advanced.battle) await saveBattle(tx, loaded.aggregate, stepped.battle);
        return { battle: stepped.battle, events };
      });
    } catch (err) {
      if (err instanceof ConflictError && attempt < 2) continue;
      throw mapError(err);
    }
    // After commit: tell the people involved. Never fails the transition.
    try {
      await notifyForEvents(deps.db, deps.push, result.battle, title, result.events);
    } catch (err) {
      console.error("notify failed", id, err);
    }
    if (result.events.some((e) => e.type === "battle.completed")) await afterBattleCompleted(deps, result.battle);
    if (result.events.some((e) => e.type === "round.submissions_opened")) await letBotPlay(deps, id);
    return result;
  }
}

/** 404 for battles this viewer may not see (private), so their existence isn't revealed. */
async function viewableRow(deps: BattleDeps, id: string, viewer: UserRow | null, code?: string | null): Promise<BattleRow> {
  const [row] = await deps.db.select().from(schema.battle).where(eq(schema.battle.id, id));
  if (!row || !(await canViewBattle(deps.db, row, viewer, code))) throw notFound();
  return row;
}

function mapError(err: unknown): unknown {
  if (err instanceof EngineError) {
    const status = err.code === "NOT_PARTICIPANT" || err.code === "NOT_CREATOR" || err.code === "NOT_INVITED" || err.code === "NOT_A_CONTENDER" ? 403 : 409;
    return new ServiceError(status, err.code, err.message);
  }
  return err;
}

/** If the VYBZ bot is in this battle and a round just opened, it picks. Never fails the transition. */
async function letBotPlay(deps: BattleDeps, id: string): Promise<void> {
  try {
    const { botPlay } = await import("../bot");
    await botPlay(deps, id);
  } catch (err) {
    console.error("bot play failed", id, err);
  }
}

/** Progression for everyone who played. Never fails the battle. */
async function afterBattleCompleted(deps: BattleDeps, agg: BattleAggregate): Promise<void> {
  try {
    await awardBattle(deps.db, agg);
    await applyRanked(deps.db, deps.push, agg, now(deps));
    await checkAchievements(deps.db, deps.push, agg.participants.map((p) => p.userId));
  } catch (err) {
    console.error("progression failed", agg.id, err);
  }
}

async function afterVote(deps: BattleDeps, voter: UserRow, battleId: string, roundIndex: number): Promise<void> {
  try {
    await awardVote(deps.db, voter.id, battleId, roundIndex, now(deps));
    await recordActivity(deps.db, voter.id, now(deps));
    await checkAchievements(deps.db, deps.push, [voter.id]);
  } catch (err) {
    console.error("progression failed", voter.id, err);
  }
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

/**
 * Who may battle. Guests (no email yet) may take part in battles they were
 * invited to or challenged into (`guestOk`), so a friend's link works with
 * one tap; starting battles of their own needs a saved account.
 */
function requireBattler(deps: BattleDeps, actor: UserRow | null, opts: { guestOk?: boolean } = {}): UserRow {
  if (!actor) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (actor.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  if (actor.isAnonymous) {
    if (!opts.guestOk) throw new ServiceError(403, "GUEST_ACCOUNT", "Save your account to start your own battles.");
    return actor;
  }
  if (deps.requireVerifiedEmail && !actor.emailVerified) throw new ServiceError(403, "EMAIL_NOT_VERIFIED", "Verify your email to battle.");
  return actor;
}

/** A battle code nobody's using: six letters people can read out or type. */
async function freeJoinCode(db: Executor): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = Array.from({ length: BATTLE_CODE_LENGTH }, () => BATTLE_CODE_ALPHABET[randomInt(BATTLE_CODE_ALPHABET.length)]).join("");
    const [taken] = await db.select({ id: schema.battle.id }).from(schema.battle).where(eq(schema.battle.joinCode, code)).limit(1);
    if (!taken) return code;
  }
  throw new ServiceError(503, "TRY_AGAIN");
}

const codeTries = new Map<string, number[]>();

/** A private challenge by its code: what the app needs to open it (id and invite code). Codes stop working once someone takes it. */
export async function battleByCode(deps: BattleDeps, userId: string, raw: string): Promise<{ id: string; code: string; title: string }> {
  // 20 lookups per 10 minutes per person, so codes can't be guessed.
  const now = Date.now();
  const recent = (codeTries.get(userId) ?? []).filter((t) => now - t < 600_000);
  if (recent.length >= 20) throw new ServiceError(429, "SLOW_DOWN", "Too many tries. Wait a few minutes.");
  codeTries.set(userId, [...recent, now]);
  const code = normalizeBattleCode(raw);
  if (!code) throw new ServiceError(404, "BATTLE_CODE_NOT_FOUND", "No challenge with that code.");
  const [row] = await deps.db.select().from(schema.battle).where(eq(schema.battle.joinCode, code)).limit(1);
  if (!row || row.status !== "OPEN_CHALLENGE") throw new ServiceError(404, "BATTLE_CODE_NOT_FOUND", "No open challenge with that code. It may have been taken already.");
  return { id: row.id, code: row.inviteCode ?? "", title: row.title };
}

export async function createBattle(deps: BattleDeps, actorIn: UserRow | null, body: unknown, opts: { dailyDate?: string; quickMatch?: boolean; ranked?: boolean; botFallback?: boolean } = {}): Promise<{ id: string }> {
  const actor = requireBattler(deps, actorIn);
  const parsed = CreateBattleSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  const req: CreateBattleRequest = parsed.data as CreateBattleRequest;

  const rulesResult = validRules(deps, req.rules);
  const duel = isDuel(rulesResult);
  if (!duel && req.opponentHandle) throw new ServiceError(400, "NOT_A_DUEL", "Use invites for multi-entry battles.");
  if (duel && req.inviteHandles?.length) throw new ServiceError(400, "NOT_MULTI", "Challenge one opponent in a duel.");

  let invitedUserId: string | null = null;
  if (req.opponentHandle) {
    const [opp] = await deps.db.select().from(schema.user).where(eq(schema.user.handle, req.opponentHandle));
    if (!opp || opp.status !== "ACTIVE") throw new ServiceError(404, "OPPONENT_NOT_FOUND", `No one called @${req.opponentHandle}`);
    if (opp.id === actor.id) throw new ServiceError(409, "OWN_BATTLE", "You can't challenge yourself.");
    invitedUserId = opp.id;
  }

  let invitees: { id: string; handle: string }[] = [];
  if (req.inviteHandles?.length) {
    const handles = [...new Set(req.inviteHandles.map((h) => h.replace(/^@/, "")))];
    invitees = await deps.db
      .select({ id: schema.user.id, handle: schema.user.handle })
      .from(schema.user)
      .where(and(inArray(schema.user.handle, handles), eq(schema.user.status, "ACTIVE")));
    const missing = handles.filter((h) => !invitees.some((u) => u.handle === h));
    if (missing.length) throw new ServiceError(404, "OPPONENT_NOT_FOUND", `No one called @${missing.join(", @")}`);
    invitees = invitees.filter((u) => u.id !== actor.id);
  }

  const { battle } = mapEngine(() => engineCreate({ creatorId: actor.id, invitedUserId, rules: rulesResult }, ctx(deps)));
  const theme = req.theme?.trim() || themeLabel(rulesResult.constraints);
  const visibility = req.visibility ?? "PUBLIC";
  await deps.db.transaction(async (tx) => {
    await insertBattle(tx, battle, { title: req.title, theme, visibility, inviteCode: newInviteCode(), dailyDate: opts.dailyDate ?? null, quickMatch: opts.quickMatch ?? false, ranked: opts.ranked ?? false, botFallback: opts.botFallback ?? true, joinCode: visibility === "PRIVATE" && !invitedUserId && duel ? await freeJoinCode(tx) : null });
    if (invitees.length) await tx.insert(schema.battleInvite).values(invitees.map((u) => ({ battleId: battle.id, userId: u.id })));
  });

  await createNotifications(deps.db, deps.push, [
    ...(invitedUserId
      ? [{ userId: invitedUserId, type: "CHALLENGED" as const, title: "You've been challenged", body: `@${actor.handle} challenged you to "${req.title}".`, battleId: battle.id }]
      : []),
    ...invitees.map((u) => ({ userId: u.id, type: "INVITED" as const, title: "You're invited", body: `@${actor.handle} invited you to "${req.title}".`, battleId: battle.id })),
  ]).catch((err) => console.error("notify failed", err));
  return { id: battle.id };
}

function mapEngine<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw mapError(err);
  }
}

/** Multi-entry: take a seat. Private battles need access (invite or link code). */
export async function joinBattle(deps: BattleDeps, actorIn: UserRow | null, id: string, code?: string | null) {
  const actor = requireBattler(deps, actorIn, { guestOk: true });
  await viewableRow(deps, id, actor, code);
  await transition(deps, id, (agg, c) => engineJoin(agg, actor.id, c));
}

export async function leaveBattle(deps: BattleDeps, actor: UserRow | null, id: string) {
  if (!actor) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  await transition(deps, id, (agg) => engineLeave(agg, actor.id));
}

/** Multi-entry: the host starts early once enough players have joined. */
export async function startBattle(deps: BattleDeps, actor: UserRow | null, id: string) {
  if (!actor) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  await transition(deps, id, (agg, c) => engineStart(agg, actor.id, c));
}

/** Propose different terms; the other side then accepts or counters. */
export async function counterBattle(deps: BattleDeps, actorIn: UserRow | null, id: string, body: unknown) {
  const actor = requireBattler(deps, actorIn, { guestOk: true });
  const rules = validRules(deps, (body as { rules?: unknown } | null)?.rules);
  await transition(deps, id, (agg, c) => counterOffer(agg, actor.id, rules, c));
  // Keep the theme label in step with the new genre/era terms.
  const label = themeLabel(rules.constraints);
  await deps.db.update(schema.battle).set({ theme: label }).where(eq(schema.battle.id, id));
}

export async function acceptBattle(deps: BattleDeps, actor: UserRow | null, id: string, code?: string | null) {
  const user = requireBattler(deps, actor, { guestOk: true });
  await viewableRow(deps, id, user, code);
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
  const actor = requireBattler(deps, actorIn, { guestOk: true });
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
    // Songs saved from a library or playlist get their YouTube match now.
    const withVideo = await ensureYouTubeMatch(deps.db, deps.catalog, t);
    // Every battle must work for listeners with no connected accounts.
    const guestSources = resolvePlayback(withVideo.refs, guestViewer(deps.catalog.storefront), deps.catalog.playback);
    if (!guestSources.some((s) => s.tier !== "LINK_OUT")) {
      throw new ServiceError(409, "TRACK_NOT_PLAYABLE", `"${t.track.title}" can't be played for everyone. Pick another version.`);
    }
    stored.push(withVideo);
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
  await recordActivity(deps.db, actor.id, now(deps));
}

// ── AI judge ───────────────────────────────────────────────────────────────

/**
 * Gets the AI judge's verdict for the open voting round if the battle uses the
 * AI and it hasn't ruled yet. Idempotent and safe to call from anywhere; the
 * verdict stays hidden until the round is scored.
 */
export async function ensureAiVerdicts(deps: BattleDeps, id: string): Promise<boolean> {
  // (Crowd rounds: asked in case the vote ties; only used then.)
  if (!deps.aiJudge) return false;
  const loaded = await loadBattle(deps.db, id);
  if (!loaded) return false;
  const { aggregate: agg, row } = loaded;
  // Crowd battles too: the AI breaks a tied or empty 90-second vote.
  if (!usesAiJudge(agg.rules.judging.mode) && agg.rules.judging.mode !== "CROWD") return false;
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
        sql`coalesce(${schema.battle.rules}->'judging'->>'mode', 'CROWD') in ('AI','COMBINED','SEPARATE','CROWD')`,
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

  await viewableRow(deps, id, actor);
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
  await viewableRow(deps, id, actor);
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
  await afterVote(deps, actor!, id, roundIndex);
}

/**
 * Runs a finished battle back with the same rules.
 *
 * - A player in it: a new duel against the other player (or a new lobby for
 *   group battles), as before.
 * - Anyone else, from a shared result card (`against` = the sharer's handle):
 *   a new duel challenging that player, same theme and rules. "Think you can
 *   beat me?" made real.
 */
export async function rematch(deps: BattleDeps, actorIn: UserRow | null, id: string, opts: { against?: string | null; code?: string | null } = {}): Promise<{ id: string }> {
  const actor = requireBattler(deps, actorIn, { guestOk: true });
  await viewableRow(deps, id, actor, opts.code);
  const loaded = await loadBattle(deps.db, id);
  if (!loaded) throw notFound();
  const { aggregate: agg, row } = loaded;
  if (agg.status !== "COMPLETE") throw new ServiceError(409, "NOT_COMPLETE");
  const me = participantFor(agg, actor.id);
  const duel = isDuel(agg.rules);
  const { BOT_HANDLE, botUser } = await import("../bot");
  if (actor.isAnonymous) {
    // Guests: a few open challenges at a time.
    const [{ n }] = (await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.battle)
      .where(and(eq(schema.battle.creatorId, actor.id), inArray(schema.battle.status, ["OPEN_CHALLENGE", "PENDING_ACCEPT"])))) as [{ n: number }];
    if (n >= 3) throw new ServiceError(429, "GUEST_LIMIT", "Save your account to send more challenges.");
  }

  let invitedUserId: string | null;
  let others: { userId: string }[];
  if (me) {
    others = agg.participants.filter((p) => p.id !== me.id);
    invitedUserId = duel ? (others[0]?.userId ?? null) : null;
  } else {
    // A challenge from a shared result: take on the player who shared it.
    const handle = (opts.against ?? "").replace(/^@/, "").toLowerCase();
    if (!handle) throw new ServiceError(403, "NOT_PARTICIPANT");
    const [opp] = await deps.db.select().from(schema.user).where(eq(schema.user.handle, handle));
    if (!opp || opp.status !== "ACTIVE" || !agg.participants.some((p) => p.userId === opp.id)) throw new ServiceError(404, "OPPONENT_NOT_FOUND", `@${handle} didn't play in this battle.`);
    if (opp.handle === BOT_HANDLE) throw new ServiceError(409, "OPPONENT_NOT_FOUND", "Challenge a player, not the bot.");
    others = [{ userId: opp.id }];
    invitedUserId = opp.id;
  }
  if (invitedUserId && (await isBlockedBetween(deps.db, actor.id, invitedUserId))) throw new ServiceError(403, "BLOCKED", "You can't challenge this player.");

  // A challenger from a shared card plays a fresh duel; group battles become a duel too.
  const rules = me ? (duel ? agg.rules : { ...agg.rules, creatorPlays: true }) : duel ? agg.rules : { ...agg.rules, entrants: { min: 2, max: 2 }, creatorPlays: true };
  const { battle } = engineCreate({ creatorId: actor.id, invitedUserId, rules }, ctx(deps));
  const base = row.title.replace(/^(Rematch|Challenge): /, "");
  const title = (me ? `Rematch: ${base}` : `Challenge: ${base}`).slice(0, 80);
  await deps.db.transaction(async (tx) => {
    await insertBattle(tx, battle, { title, theme: row.theme, rematchOfId: row.id, visibility: row.visibility, inviteCode: newInviteCode() });
    if (!invitedUserId && others.length) await tx.insert(schema.battleInvite).values(others.map((p) => ({ battleId: battle.id, userId: p.userId })));
  });

  // The bot always takes a rematch.
  const bot = invitedUserId ? await botUser(deps).catch(() => null) : null;
  if (bot && bot.id === invitedUserId) {
    await acceptBattle(deps, bot, battle.id);
    return { id: battle.id };
  }
  await createNotifications(
    deps.db,
    deps.push,
    others.map((p) => ({
      userId: p.userId,
      type: invitedUserId ? ("CHALLENGED" as const) : ("INVITED" as const),
      title: me ? "Rematch?" : "New challenger",
      body: me ? `@${actor.handle} wants to run "${row.title}" back.` : `@${actor.handle} saw your result and wants a shot: "${base}".`,
      battleId: battle.id,
    })),
  ).catch((err) => console.error("notify failed", err));
  return { id: battle.id };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getBattleView(deps: BattleDeps, viewer: UserRow | null, id: string, caps: PlaybackCaps = NO_CAPS, code?: string | null): Promise<BattleView> {
  await viewableRow(deps, id, viewer, code);
  await advanceIfDue(deps, id);
  const loaded = await loadBattle(deps.db, id);
  if (!loaded) throw notFound();
  const { aggregate: agg, row } = loaded;

  const userIds = [...new Set([agg.creatorId, agg.invitedUserId, ...agg.participants.map((p) => p.userId)].filter((x): x is string => !!x))];
  const trackIds = [...new Set(agg.submissions.map((s) => s.trackId))];
  const roundIds = agg.rounds.map((r) => r.id);

  const [users, tracks, refs, proofs, votes, verdicts, hearts, myHearts, stats] = await Promise.all([
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
    deps.db
      .select({ submissionId: schema.trackHeart.submissionId, n: sql<number>`count(*)::int` })
      .from(schema.trackHeart)
      .where(eq(schema.trackHeart.battleId, id))
      .groupBy(schema.trackHeart.submissionId),
    viewer
      ? deps.db.select({ submissionId: schema.trackHeart.submissionId }).from(schema.trackHeart).where(and(eq(schema.trackHeart.battleId, id), eq(schema.trackHeart.voterId, viewer.id)))
      : [],
    agg.status === "IN_PROGRESS" || agg.status === "COMPLETE" ? battleStats(deps, id) : null,
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
    hearts: new Map(hearts.map((h) => [h.submissionId, h.n])),
    myHearts: new Set(myHearts.map((h) => h.submissionId)),
    stats,
    isModerator: isStaff(viewer),
    viewer,
    deploymentVerifiesEmail: deps.requireVerifiedEmail,
    now: now(deps),
    caps,
    playback: deps.catalog.playback,
    storefront: deps.catalog.storefront,
  };
  return buildBattleView(data);
}

/** Votes, voters, listeners, completion rate and the most-hearted track. */
export async function battleStats(deps: BattleDeps, id: string): Promise<BattleStats> {
  const roundIds = deps.db.select({ id: schema.battleRound.id }).from(schema.battleRound).where(eq(schema.battleRound.battleId, id));
  const [[votes], [listeners], [reactions], [chats], [top]] = await Promise.all([
    deps.db
      .select({ total: sql<number>`count(*)::int`, voters: sql<number>`count(distinct ${schema.vote.voterId})::int` })
      .from(schema.vote)
      .where(and(eq(schema.vote.battleId, id), ne(schema.vote.status, "VOIDED"))),
    deps.db.select({ n: sql<number>`count(distinct ${schema.listenProof.userId})::int` }).from(schema.listenProof).where(inArray(schema.listenProof.roundId, roundIds)),
    deps.db.select({ n: sql<number>`count(*)::int` }).from(schema.reaction).where(eq(schema.reaction.battleId, id)),
    deps.db.select({ n: sql<number>`count(*)::int` }).from(schema.chatMessage).where(and(eq(schema.chatMessage.battleId, id), isNull(schema.chatMessage.hiddenAt))),
    deps.db
      .select({ submissionId: schema.trackHeart.submissionId, n: sql<number>`count(*)::int` })
      .from(schema.trackHeart)
      .where(eq(schema.trackHeart.battleId, id))
      .groupBy(schema.trackHeart.submissionId)
      .orderBy(sql`2 desc`)
      .limit(1),
  ]);
  let topTrack: BattleStats["topTrack"] = null;
  if (top) {
    const [row] = await deps.db
      .select({ track: schema.track, participantId: schema.submission.participantId })
      .from(schema.submission)
      .innerJoin(schema.track, eq(schema.track.id, schema.submission.trackId))
      .where(eq(schema.submission.id, top.submissionId));
    if (row) topTrack = { track: toTrackView(row.track), hearts: top.n, participantId: row.participantId };
  }
  const l = listeners?.n ?? 0;
  const v = votes?.voters ?? 0;
  return {
    totalVotes: votes?.total ?? 0,
    uniqueVoters: v,
    listeners: Math.max(l, v),
    completionRate: l ? Math.min(1, v / l) : v ? 1 : 0,
    reactions: reactions?.n ?? 0,
    chatMessages: chats?.n ?? 0,
    topTrack,
  };
}

/**
 * Per-track hearts: audience members can heart any track they've listened to
 * long enough, while voting is open. They don't affect scoring; they surface
 * the crowd's favourite tracks.
 */
export async function setHeart(deps: BattleDeps, actor: UserRow | null, id: string, roundIndex: number, body: unknown) {
  if (!actor) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (actor.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  const b = (body ?? {}) as { submissionId?: unknown; hearted?: unknown };
  if (typeof b.submissionId !== "string" || typeof b.hearted !== "boolean") throw new ServiceError(400, "INVALID_REQUEST");
  await viewableRow(deps, id, actor);
  await advanceIfDue(deps, id);
  const loaded = await loadBattle(deps.db, id);
  if (!loaded) throw notFound();
  const agg = loaded.aggregate;
  const round = currentRound(agg);
  if (!round || round.index !== roundIndex || round.status !== "VOTING_OPEN") throw new ServiceError(409, "VOTING_CLOSED");
  if (participantFor(agg, actor.id)) throw new ServiceError(403, "PARTICIPANT");
  const sub = agg.submissions.find((s) => s.id === b.submissionId && s.roundId === round.id);
  if (!sub) throw new ServiceError(404, "UNKNOWN_SUBMISSION");

  if (!b.hearted) {
    await deps.db.delete(schema.trackHeart).where(and(eq(schema.trackHeart.submissionId, sub.id), eq(schema.trackHeart.voterId, actor.id)));
    return;
  }
  const [proof] = await deps.db
    .select()
    .from(schema.listenProof)
    .where(and(eq(schema.listenProof.roundId, round.id), eq(schema.listenProof.userId, actor.id), eq(schema.listenProof.submissionId, sub.id)));
  const [track] = await deps.db.select({ durationMs: schema.track.durationMs }).from(schema.track).where(eq(schema.track.id, sub.trackId));
  if (!proof || proof.playedMs < requiredListenMs(agg.rules.fairListen.minPlayedMs, track?.durationMs, proof.tier as PlaybackTier)) {
    throw new ServiceError(403, "LISTEN_REQUIRED", "Listen to the track before hearting it.");
  }
  await deps.db.insert(schema.trackHeart).values({ submissionId: sub.id, voterId: actor.id, battleId: agg.id, roundId: round.id }).onConflictDoNothing();
}

/** Moderators: feature or unfeature a battle on Home. */
export async function setFeatured(deps: BattleDeps, actor: UserRow | null, id: string, featured: boolean) {
  if (!isStaff(actor)) throw new ServiceError(403, "FORBIDDEN");
  const updated = await deps.db.update(schema.battle).set({ featured }).where(eq(schema.battle.id, id)).returning({ id: schema.battle.id });
  if (!updated.length) throw notFound();
  await deps.db.insert(schema.moderationAction).values({ id: newId(), moderatorId: actor!.id, action: featured ? "FEATURE" : "UNFEATURE", subjectType: "BATTLE", subjectId: id });
}

/** Moderators: void a battle (results and ratings ignore it). */
export async function voidBattleAsModerator(deps: BattleDeps, actor: UserRow | null, id: string, note?: string) {
  if (!isStaff(actor)) throw new ServiceError(403, "FORBIDDEN");
  await transition(deps, id, (agg, c) => engineVoid(agg, c));
  await deps.db.insert(schema.moderationAction).values({ id: newId(), moderatorId: actor!.id, action: "VOID_BATTLE", subjectType: "BATTLE", subjectId: id, note: note ?? null });
}

export async function usersById(db: Executor, ids: string[]): Promise<Map<string, UserSummary>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: schema.user.id, handle: schema.user.handle, displayName: schema.user.name, image: schema.user.image, frame: schema.userProgress.frame })
    .from(schema.user)
    .leftJoin(schema.userProgress, eq(schema.userProgress.userId, schema.user.id))
    .where(inArray(schema.user.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function listBattles(deps: BattleDeps, viewer: UserRow | null, feed: BattleFeed, limit = 30): Promise<BattleListItem[]> {
  const b = schema.battle;
  const p = schema.battleParticipant;
  let where;
  const isPublic = eq(b.visibility, "PUBLIC");
  switch (feed) {
    case "open":
      where = and(isPublic, eq(b.status, "OPEN_CHALLENGE"), viewer ? ne(b.creatorId, viewer.id) : undefined);
      break;
    case "featured":
      where = and(isPublic, eq(b.featured, true), inArray(b.status, ["OPEN_CHALLENGE", "IN_PROGRESS", "COMPLETE"]));
      break;
    case "daily":
      where = and(isPublic, isNotNull(b.dailyDate));
      break;
    case "mine":
      if (!viewer) return [];
      where = or(
        eq(b.creatorId, viewer.id),
        eq(b.invitedUserId, viewer.id),
        inArray(b.id, deps.db.select({ id: p.battleId }).from(p).where(eq(p.userId, viewer.id))),
        inArray(b.id, deps.db.select({ id: schema.battleInvite.battleId }).from(schema.battleInvite).where(eq(schema.battleInvite.userId, viewer.id))),
      );
      break;
    case "vote":
      where = and(
        isPublic,
        eq(b.status, "IN_PROGRESS"),
        sql`coalesce(${b.rules}->'judging'->>'mode', 'CROWD') <> 'AI'`,
        inArray(b.id, deps.db.select({ id: schema.battleRound.battleId }).from(schema.battleRound).where(eq(schema.battleRound.status, "VOTING_OPEN"))),
        viewer ? sql`not exists (select 1 from ${p} where ${p.battleId} = ${b.id} and ${p.userId} = ${viewer.id})` : undefined,
      );
      break;
    default:
      where = and(isPublic, inArray(b.status, ["IN_PROGRESS", "COMPLETE", "OPEN_CHALLENGE"]));
  }

  const order = feed === "daily" ? desc(b.dailyDate) : desc(b.updatedAt);
  const rows = await deps.db.select().from(b).where(where).orderBy(order).limit(feed === "daily" ? 7 : limit);
  const items = await toListItems(deps, viewer, rows);
  if (feed === "vote") return items.filter((i) => i.viewerAction === "vote");
  if (feed === "mine") {
    const rank: Record<ViewerAction, number> = { accept: 0, join: 1, submit: 2, vote: 3, wait: 4, none: 5 };
    return [...items].sort((x, y) => rank[x.viewerAction] - rank[y.viewerAction]);
  }
  return items;
}

export async function toListItems(deps: BattleDeps, viewer: UserRow | null, rows: (typeof schema.battle.$inferSelect)[]): Promise<BattleListItem[]> {
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
      const rules = parseRules(r.rules);
      const multi = !isDuel(rules);
      if (r.status === "PENDING_ACCEPT" && awaiting === viewer.id && acceptOpen) action = "accept";
      else if (r.status === "OPEN_CHALLENGE" && multi && !isParticipant && acceptOpen && ps.length < rules.entrants.max) action = "join";
      else if (r.status === "OPEN_CHALLENGE" && multi && isParticipant) action = "wait";
      else if (r.status === "OPEN_CHALLENGE" && !multi && r.creatorId !== viewer.id && acceptOpen) action = "accept";
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
      participants: ps.map((x) => ({ id: x.id, side: x.side, user: users.get(x.userId)!, roundsWon: x.roundsWon })),
      format: isDuel(parseRules(r.rules)) ? ("DUEL" as const) : ("MULTI" as const),
      visibility: r.visibility,
      featured: r.featured,
      dailyDate: r.dailyDate,
      maxEntrants: parseRules(r.rules).entrants.max,
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
    .where(and(eq(b.status, "COMPLETE"), sql`${p.userId} not in (select id from "user" where is_system)`))
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
    user: (await usersById(deps.db, [u.id])).get(u.id)!,
    record: all,
    recent: await toListItems(deps, viewer, rows),
    social: await socialFor(deps.db, viewer, u.id),
    artist: await deps.db
      .select({ name: schema.artistProfile.name })
      .from(schema.artistProfile)
      .where(and(eq(schema.artistProfile.userId, u.id), eq(schema.artistProfile.status, "VERIFIED")))
      .then((r) => r[0] ?? null),
    pro: await deps.db
      .select({ status: schema.subscription.status, expiresAt: schema.subscription.expiresAt })
      .from(schema.subscription)
      .where(eq(schema.subscription.userId, u.id))
      .then((r) => !!r[0] && (r[0].status === "ACTIVE" || r[0].status === "GRACE") && !!r[0].expiresAt && r[0].expiresAt > now(deps)),
    rank: await deps.db
      .select()
      .from(schema.userRating)
      .where(and(eq(schema.userRating.userId, u.id), eq(schema.userRating.season, seasonOf(now(deps)))))
      .then((r) => {
        if (!r[0] || !r[0].games) return null;
        const v = rankView(r[0]);
        return { rating: v.rating, divisionLabel: v.divisionLabel, icon: v.icon, placement: v.placement };
      }),
    // This week's league (or the last one they played in) and past ranked seasons.
    league: await deps.db
      .select({ tier: schema.leagueMember.tier, week: schema.leagueMember.week })
      .from(schema.leagueMember)
      .where(eq(schema.leagueMember.userId, u.id))
      .orderBy(desc(schema.leagueMember.week))
      .limit(1)
      .then((r) => {
        const l = r[0] ? LEAGUES[r[0].tier] : null;
        return l ? { label: l.label, icon: l.icon } : null;
      }),
    seasonBadges: await deps.db
      .select()
      .from(schema.seasonBadge)
      .where(eq(schema.seasonBadge.userId, u.id))
      .orderBy(desc(schema.seasonBadge.season))
      .limit(8)
      .then((rows) =>
        rows.map((b) => {
          const d = DIVISIONS.find((x) => x.key === b.division) ?? DIVISIONS[0];
          return { season: b.season, label: d.label, icon: d.icon };
        }),
      ),
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

