import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
    status: text("status", { enum: ["ACTIVE", "SUSPENDED", "BANNED", "DELETED"] })
      .notNull()
      .default("ACTIVE"),
    /** VYBZ's own accounts (the daily host, the bot): kept off leaderboards and out of rewards. */
    isSystem: boolean("is_system").notNull().default(false),
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
    /** PUBLIC battles appear in feeds; PRIVATE ones only for participants, invitees and invite-link holders. */
    visibility: text("visibility", { enum: ["PUBLIC", "PRIVATE"] })
      .notNull()
      .default("PUBLIC"),
    /** Secret for invite links (?code=). */
    inviteCode: text("invite_code"),
    featured: boolean("featured").notNull().default(false),
    /** Set on the system's daily battle: one per UTC day. */
    dailyDate: text("daily_date").unique(),
    /** An open challenge from Quick Battle: anyone may take it, and the VYBZ bot does if nobody does. */
    quickMatch: boolean("quick_match").notNull().default(false),
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
    check("participant_side_check", sql`${t.side} between 0 and 7`),
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
    /** Who plays this round; null = every participant. */
    contenderIds: text("contender_ids").array(),
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

// ── Invites and access ─────────────────────────────────────────────────────

/** People invited to a battle (notified; can see it even when private). */
export const battleInvite = pgTable(
  "battle_invite",
  {
    battleId: text("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.battleId, t.userId] })],
);

/** Signed-in users who opened a private battle with a valid invite link. */
export const battleAccess = pgTable(
  "battle_access",
  {
    battleId: text("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.battleId, t.userId] })],
);

// ── Per-track hearts ───────────────────────────────────────────────────────

export const trackHeart = pgTable(
  "track_heart",
  {
    submissionId: text("submission_id")
      .notNull()
      .references(() => submission.id, { onDelete: "cascade" }),
    voterId: text("voter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    battleId: text("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    roundId: text("round_id")
      .notNull()
      .references(() => battleRound.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.submissionId, t.voterId] }), index("heart_battle_idx").on(t.battleId)],
);

// ── Live layer ─────────────────────────────────────────────────────────────

export const chatMessage = pgTable(
  "chat_message",
  {
    id: text("id").primaryKey(),
    battleId: text("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** A GIF from GIPHY (id, url, size, title); validated on write. */
    gif: jsonb("gif"),
    hiddenAt: ts("hidden_at"),
    hiddenById: text("hidden_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("chat_battle_idx").on(t.battleId, t.id), index("chat_user_idx").on(t.userId, t.createdAt)],
);

export const reaction = pgTable(
  "reaction",
  {
    id: text("id").primaryKey(),
    battleId: text("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    viewerKey: text("viewer_key").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("reaction_battle_idx").on(t.battleId, t.createdAt), index("reaction_viewer_idx").on(t.viewerKey, t.createdAt)],
);

/** Heartbeats from people watching a battle, for viewer counts. */
export const battlePresence = pgTable(
  "battle_presence",
  {
    battleId: text("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    viewerKey: text("viewer_key").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    lastSeen: ts("last_seen").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.battleId, t.viewerKey] }), index("presence_seen_idx").on(t.battleId, t.lastSeen)],
);

// ── Notifications ──────────────────────────────────────────────────────────

export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    battleId: text("battle_id").references(() => battle.id, { onDelete: "cascade" }),
    /** In-app path to open, e.g. /post/<id>, /messages/<id>, /user/<handle>. */
    link: text("link"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.createdAt)],
);

export const pushToken = pgTable(
  "push_token",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("push_token_user_idx").on(t.userId)],
);

// ── Moderation ─────────────────────────────────────────────────────────────

export const report = pgTable(
  "report",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    subjectType: text("subject_type", { enum: ["CHAT_MESSAGE", "BATTLE", "USER", "POST", "COMMENT", "DIRECT_MESSAGE"] }).notNull(),
    subjectId: text("subject_id").notNull(),
    battleId: text("battle_id").references(() => battle.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["OPEN", "ACTIONED", "DISMISSED"] })
      .notNull()
      .default("OPEN"),
    handledById: text("handled_by_id").references(() => user.id),
    handledAt: ts("handled_at"),
    action: text("action"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("report_once_uq").on(t.reporterId, t.subjectType, t.subjectId),
    index("report_status_idx").on(t.status, t.createdAt),
  ],
);

/** Audit trail of moderator actions. */
export const moderationAction = pgTable("moderation_action", {
  id: text("id").primaryKey(),
  moderatorId: text("moderator_id")
    .notNull()
    .references(() => user.id),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

// ── Library and playlists ──────────────────────────────────────────────────

/** Songs a user saved. */
export const libraryTrack = pgTable(
  "library_track",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => track.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.trackId] }), index("library_track_user_idx").on(t.userId, t.createdAt)],
);

export const playlist = pgTable(
  "playlist",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    visibility: text("visibility", { enum: ["PUBLIC", "PRIVATE"] })
      .notNull()
      .default("PRIVATE"),
    /** Lets people with the link open a private playlist. */
    shareCode: text("share_code").notNull(),
    /** The theme it was generated for, if any (VYBZ genre keys and years). */
    genres: text("genres").array().notNull().default(sql`'{}'::text[]`),
    eraFrom: integer("era_from"),
    eraTo: integer("era_to"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("playlist_owner_idx").on(t.ownerId, t.updatedAt), index("playlist_public_idx").on(t.visibility, t.updatedAt)],
);

export const playlistTrack = pgTable(
  "playlist_track",
  {
    playlistId: text("playlist_id")
      .notNull()
      .references(() => playlist.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => track.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    addedById: text("added_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.playlistId, t.trackId] }), index("playlist_track_order_idx").on(t.playlistId, t.position)],
);

/** People the owner lets add, remove and reorder songs. */
export const playlistCollaborator = pgTable(
  "playlist_collaborator",
  {
    playlistId: text("playlist_id")
      .notNull()
      .references(() => playlist.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.playlistId, t.userId] }), index("playlist_collaborator_user_idx").on(t.userId)],
);

// ── Social ─────────────────────────────────────────────────────────────────

export const follow = pgTable(
  "follow",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    followeeId: text("followee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index("follow_followee_idx").on(t.followeeId), check("follow_not_self", sql`${t.followerId} <> ${t.followeeId}`)],
);

/** Blocking hides both people from each other: feeds, comments, follows and messages. */
export const block = pgTable(
  "block",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("block_blocked_idx").on(t.blockedId)],
);

export const post = pgTable(
  "post",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** A GIF from GIPHY (id, url, size, title); validated on write. */
    gif: jsonb("gif"),
    /** At most one attachment. */
    trackId: text("track_id").references(() => track.id, { onDelete: "set null" }),
    playlistId: text("playlist_id").references(() => playlist.id, { onDelete: "set null" }),
    battleId: text("battle_id").references(() => battle.id, { onDelete: "set null" }),
    hiddenAt: ts("hidden_at"),
    hiddenById: text("hidden_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("post_author_idx").on(t.authorId, t.createdAt), index("post_created_idx").on(t.createdAt)],
);

export const postLike = pgTable(
  "post_like",
  {
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const postComment = pgTable(
  "post_comment",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** A GIF from GIPHY (id, url, size, title); validated on write. */
    gif: jsonb("gif"),
    hiddenAt: ts("hidden_at"),
    hiddenById: text("hidden_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("post_comment_post_idx").on(t.postId, t.createdAt), index("post_comment_author_idx").on(t.authorId, t.createdAt)],
);

/** A one-to-one conversation. userA < userB so each pair has one row. */
export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    userA: text("user_a")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userB: text("user_b")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastMessageAt: ts("last_message_at"),
    aReadAt: ts("a_read_at"),
    bReadAt: ts("b_read_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("conversation_pair_uq").on(t.userA, t.userB), index("conversation_b_idx").on(t.userB), check("conversation_order", sql`${t.userA} < ${t.userB}`)],
);

export const directMessage = pgTable(
  "direct_message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** A GIF from GIPHY (id, url, size, title); validated on write. */
    gif: jsonb("gif"),
    hiddenAt: ts("hidden_at"),
    createdAt: createdAt(),
  },
  (t) => [index("direct_message_conv_idx").on(t.conversationId, t.createdAt), index("direct_message_sender_idx").on(t.senderId, t.createdAt)],
);

// ── Progression ────────────────────────────────────────────────────────────

/** Achievements someone has unlocked. Codes come from the catalog in @vybz/core. */
export const userAchievement = pgTable(
  "user_achievement",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    unlockedAt: ts("unlocked_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.code] })],
);

/** Running totals; the ledger is the source of truth. */
export const userProgress = pgTable("user_progress", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  xp: integer("xp").notNull().default(0),
  coins: integer("coins").notNull().default(0),
  level: integer("level").notNull().default(1),
  /** IANA zone from the app's last daily claim; days are counted in it. */
  timeZone: text("time_zone"),
  /** Streak freezes held (bought in the shop, used up automatically). */
  streakFreezes: integer("streak_freezes").notNull().default(0),
  /** Profile frame shown around the avatar (a shop item key). */
  frame: text("frame"),
  updatedAt: updatedAt(),
});

/** Every XP and coin change. (user, reason, ref) is unique so each award happens once. */
export const ledgerEntry = pgTable(
  "ledger_entry",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    ref: text("ref").notNull(),
    xp: integer("xp").notNull().default(0),
    coins: integer("coins").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ledger_once_uq").on(t.userId, t.reason, t.ref), index("ledger_user_idx").on(t.userId, t.createdAt)],
);

/** One row per day someone claimed their daily reward. */
export const dailyClaim = pgTable(
  "daily_claim",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Local date, YYYY-MM-DD, in the claimer's time zone. */
    day: text("day").notNull(),
    /** Consecutive days including this one. */
    streakDay: integer("streak_day").notNull(),
    /** A missed day covered by a streak freeze rather than a claim (no reward). */
    frozen: boolean("frozen").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/** Cosmetics someone owns. Consumables (streak freezes) are a count on user_progress. */
export const userItem = pgTable(
  "user_item",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    item: text("item").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.item] })],
);

/** Reminders already sent, so each goes out at most once a day. */
export const reminderSent = pgTable(
  "reminder_sent",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The person's local date, YYYY-MM-DD. */
    day: text("day").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.day] })],
);

/** Likes on post comments. */
export const commentLike = pgTable(
  "comment_like",
  {
    commentId: text("comment_id")
      .notNull()
      .references(() => postComment.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

/** Likes on battle chat messages. */
export const chatLike = pgTable(
  "chat_like",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => chatMessage.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

export type User = typeof user.$inferSelect;
export type Track = typeof track.$inferSelect;
export type TrackProviderRefRow = typeof trackProviderRef.$inferSelect;
export type BattleRow = typeof battle.$inferSelect;
export type RoundRow = typeof battleRound.$inferSelect;

// ── Trivia ─────────────────────────────────────────────────────────────────

/** A trivia question. Only APPROVED questions are served; staff review the rest. */
export const triviaQuestion = pgTable(
  "trivia_question",
  {
    id: text("id").primaryKey(),
    category: text("category", { enum: ["GENRE", "ARTIST", "ALBUM_ART", "HISTORY", "GUESS_SONG"] }).notNull(),
    /** Canonical genre key, when the question is about one. */
    genre: text("genre"),
    /** 1 easy, 2 medium, 3 hard. */
    difficulty: integer("difficulty").notNull().default(2),
    prompt: text("prompt").notNull(),
    choices: text("choices").array().notNull(),
    answerIndex: integer("answer_index").notNull(),
    explanation: text("explanation"),
    /** Album art and Guess the song questions point at a catalog track (artwork and preview stay provider-hosted). */
    trackId: text("track_id").references(() => track.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["SEED", "CATALOG", "AI", "ADMIN"] }).notNull(),
    status: text("status", { enum: ["DRAFT", "APPROVED", "REJECTED", "RETIRED"] }).notNull().default("DRAFT"),
    /** Stops the same generated or seeded question being added twice. */
    dedupeKey: text("dedupe_key").unique(),
    timesAsked: integer("times_asked").notNull().default(0),
    timesCorrect: integer("times_correct").notNull().default(0),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    reviewedById: text("reviewed_by_id").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("trivia_question_pick_idx").on(t.status, t.category, t.genre),
    check("trivia_question_answer_ck", sql`${t.answerIndex} >= 0 and ${t.answerIndex} < cardinality(${t.choices})`),
  ],
);

/** A game's questions: one shared DAILY set per day, or a PRACTICE set per game. */
export const triviaSet = pgTable(
  "trivia_set",
  {
    id: text("id").primaryKey(),
    mode: text("mode", { enum: ["DAILY", "PRACTICE"] }).notNull(),
    /** YYYY-MM-DD for daily sets. */
    day: text("day"),
    category: text("category"),
    genre: text("genre"),
    questionIds: text("question_ids").array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("trivia_set_daily_uq").on(t.day).where(sql`${t.mode} = 'DAILY'`)],
);

/** One person's game. Answers are checked one at a time on the server, against a clock. */
export const triviaPlay = pgTable(
  "trivia_play",
  {
    id: text("id").primaryKey(),
    setId: text("set_id")
      .notNull()
      .references(() => triviaSet.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** [{ questionId, choice (null on timeout), correct, points, ms }] */
    answers: jsonb("answers").notNull().default(sql`'[]'::jsonb`),
    /** When the current (next unanswered) question was shown. */
    servedAt: ts("served_at"),
    score: integer("score").notNull().default(0),
    correct: integer("correct").notNull().default(0),
    total: integer("total").notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [uniqueIndex("trivia_play_once_uq").on(t.setId, t.userId), index("trivia_play_user_idx").on(t.userId, t.startedAt)],
);

/** "Something's wrong with this question" from a player, for the review queue. */
export const triviaFlag = pgTable(
  "trivia_flag",
  {
    questionId: text("question_id")
      .notNull()
      .references(() => triviaQuestion.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.userId] })],
);
