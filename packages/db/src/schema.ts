import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * VYBZ schema. Conventions: text ids (generated in app code), timestamptz
 * everywhere, enums kept as checked text so the engine's unions stay the
 * single source of truth and migrations stay simple.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ── Identity (Better Auth tables, plus VYBZ fields on user) ────────────────

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    /** Display name. Better Auth calls it `name`. */
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    handle: text("handle").notNull().unique(),
    role: text("role", { enum: ["USER", "CREATOR", "MODERATOR", "ADMIN"] })
      .notNull()
      .default("USER"),
    status: text("status", { enum: ["ACTIVE", "SUSPENDED", "BANNED"] })
      .notNull()
      .default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("user_handle_format", sql`${t.handle} ~ '^[a-z0-9_]{3,20}$'`)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId), uniqueIndex("account_provider_uq").on(t.providerId, t.accountId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ── Catalog (metadata only; playback is resolved per viewer, never stored) ─

export const track = pgTable("track", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  artistName: text("artist_name").notNull(),
  albumName: text("album_name"),
  isrc: text("isrc").unique(),
  releaseYear: integer("release_year"),
  durationMs: integer("duration_ms"),
  /** Provider-hosted URL. Never re-hosted. */
  artworkUrl: text("artwork_url"),
  explicit: boolean("explicit").notNull().default(false),
  genres: text("genres").array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const trackProviderRef = pgTable(
  "track_provider_ref",
  {
    id: text("id").primaryKey(),
    trackId: text("track_id")
      .notNull()
      .references(() => track.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["APPLE_MUSIC", "YOUTUBE", "VYBZ_DEMO"] }).notNull(),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    previewUrl: text("preview_url"),
    embeddable: boolean("embeddable"),
    lastSyncedAt: ts("last_synced_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("track_ref_provider_uq").on(t.provider, t.externalId), index("track_ref_track_idx").on(t.trackId)],
);

// ── Battles ────────────────────────────────────────────────────────────────

export const BATTLE_STATUSES = ["OPEN_CHALLENGE", "PENDING_ACCEPT", "IN_PROGRESS", "COMPLETE", "CANCELLED", "EXPIRED", "VOIDED"] as const;
export const ROUND_STATUSES = ["PENDING", "SUBMISSIONS_OPEN", "VOTING_OPEN", "SCORED", "VOIDED"] as const;

export const battle = pgTable(
  "battle",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["SONG"] })
      .notNull()
      .default("SONG"),
    status: text("status", { enum: BATTLE_STATUSES }).notNull(),
    title: text("title").notNull(),
    theme: text("theme"),
    /** Validated BattleRules. */
    rules: jsonb("rules").notNull(),
    roundCount: integer("round_count").notNull(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id),
    invitedUserId: text("invited_user_id").references(() => user.id),
    acceptDeadline: ts("accept_deadline"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    winnerParticipantId: text("winner_participant_id"),
    rematchOfId: text("rematch_of_id"),
    /** Who proposed the current terms (null on battles created before negotiation existed: the creator). */
    proposedById: text("proposed_by_id").references(() => user.id),
    previousRules: jsonb("previous_rules"),
    counterCount: integer("counter_count").notNull().default(0),
    /** When the scheduler next needs to look at this battle. */
    nextDeadlineAt: ts("next_deadline_at"),
    /** Optimistic lock for state transitions. */
    version: integer("version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("battle_status_idx").on(t.status, t.createdAt),
    index("battle_deadline_idx").on(t.nextDeadlineAt),
    index("battle_creator_idx").on(t.creatorId),
    index("battle_invited_idx").on(t.invitedUserId),
  ],
);

export const battleParticipant = pgTable(
  "battle_participant",
  {
    id: text("id").primaryKey(),
    battleId: text("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    side: integer("side").notNull(),
    roundsWon: integer("rounds_won").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("participant_battle_user_uq").on(t.battleId, t.userId),
    uniqueIndex("participant_battle_side_uq").on(t.battleId, t.side),
    index("participant_user_idx").on(t.userId),
    check("participant_side_check", sql`${t.side} in (0, 1)`),
  ],
);

export const battleRound = pgTable(
  "battle_round",
  {
    id: text("id").primaryKey(),
    battleId: text("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    status: text("status", { enum: ROUND_STATUSES }).notNull(),
    suddenDeath: boolean("sudden_death").notNull().default(false),
    submissionsCloseAt: ts("submissions_close_at"),
    votingOpensAt: ts("voting_opens_at"),
    votingClosesAt: ts("voting_closes_at"),
    extensions: integer("extensions").notNull().default(0),
    winnerParticipantId: text("winner_participant_id"),
    aiWinnerParticipantId: text("ai_winner_participant_id"),
    forfeitParticipantIds: text("forfeit_participant_ids").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [uniqueIndex("round_battle_index_uq").on(t.battleId, t.index)],
);

export const submission = pgTable(
  "submission",
  {
    id: text("id").primaryKey(),
    battleId: text("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    roundId: text("round_id")
      .notNull()
      .references(() => battleRound.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => battleParticipant.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => track.id),
    /** Order within the side's set for the round. */
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("submission_round_participant_position_uq").on(t.roundId, t.participantId, t.position),
    // The same track can't be used twice in one battle.
    uniqueIndex("submission_battle_track_uq").on(t.battleId, t.trackId),
  ],
);

export const vote = pgTable(
  "vote",
  {
    id: text("id").primaryKey(),
    battleId: text("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    roundId: text("round_id")
      .notNull()
      .references(() => battleRound.id, { onDelete: "cascade" }),
    voterId: text("voter_id")
      .notNull()
      .references(() => user.id),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submission.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => battleParticipant.id, { onDelete: "cascade" }),
    /** Applied at tally time; lowered or zeroed by fraud checks. */
    weight: real("weight").notNull().default(1),
    status: text("status", { enum: ["COUNTED", "DISCOUNTED", "VOIDED"] })
      .notNull()
      .default("COUNTED"),
    /** The playback tier both sides were heard at. */
    tier: text("tier").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // One vote per user per round, enforced by the database.
    uniqueIndex("vote_round_voter_uq").on(t.roundId, t.voterId),
    index("vote_battle_idx").on(t.battleId),
  ],
);

/**
 * The AI judge's verdict for a round: computed once when voting opens, kept
 * hidden until the round is scored. It never sees who picked which side.
 */
export const aiVerdict = pgTable("ai_verdict", {
  roundId: text("round_id")
    .primaryKey()
    .references(() => battleRound.id, { onDelete: "cascade" }),
  battleId: text("battle_id")
    .notNull()
    .references(() => battle.id, { onDelete: "cascade" }),
  winnerParticipantId: text("winner_participant_id")
    .notNull()
    .references(() => battleParticipant.id, { onDelete: "cascade" }),
  confidence: real("confidence").notNull(),
  reason: text("reason").notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
});

/** Evidence a voter played a submission before voting. */
export const listenProof = pgTable(
  "listen_proof",
  {
    id: text("id").primaryKey(),
    roundId: text("round_id")
      .notNull()
      .references(() => battleRound.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submission.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(),
    playedMs: integer("played_ms").notNull().default(0),
    startedAt: ts("started_at").notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("listen_round_user_submission_uq").on(t.roundId, t.userId, t.submissionId)],
);

export type User = typeof user.$inferSelect;
export type Track = typeof track.$inferSelect;
export type TrackProviderRefRow = typeof trackProviderRef.$inferSelect;
export type BattleRow = typeof battle.$inferSelect;
export type RoundRow = typeof battleRound.$inferSelect;
