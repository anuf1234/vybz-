-- Phase 1 foundation: profiles split from users, music catalog and
-- connections, playlists, the battle state machine, social, progression and
-- uploads. Hand edits below the generated SQL: data copy into profiles and
-- CHECK constraints Prisma can't express.

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('APPLE_MUSIC', 'YOUTUBE', 'SPOTIFY');

-- CreateEnum
CREATE TYPE "MusicConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PlaylistKind" AS ENUM ('PERSONAL', 'BATTLE_ENTRY');

-- CreateEnum
CREATE TYPE "BattleType" AS ENUM ('SONG_FOR_SONG', 'PLAYLIST', 'DJ_MIX', 'LIVE_DJ');

-- CreateEnum
CREATE TYPE "BattleStatus" AS ENUM ('DRAFT', 'CHALLENGE_SENT', 'ACCEPTED', 'SCHEDULED', 'ACTIVE', 'VOTING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BattleVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ChallengeMode" AS ENUM ('DIRECT', 'OPEN', 'MATCHMAKING');

-- CreateEnum
CREATE TYPE "CancelReason" AS ENUM ('WITHDRAWN', 'DECLINED', 'EXPIRED', 'LINEUP_MISSED', 'MODERATED');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "ReactionKind" AS ENUM ('FIRE', 'HEART', 'LAUGH', 'MIND_BLOWN', 'CLAP');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CHALLENGE_RECEIVED', 'CHALLENGE_ACCEPTED', 'CHALLENGE_DECLINED', 'LINEUP_NEEDED', 'BATTLE_LIVE', 'BATTLE_RESULT', 'NEW_FOLLOWER', 'BADGE_EARNED');

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('AVATAR', 'MIX');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'READY', 'REJECTED');

-- CreateTable
CREATE TABLE "profiles" (
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "avatarUploadId" TEXT,
    "favoriteGenres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "xp" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "music_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ProviderKind" NOT NULL,
    "status" "MusicConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "externalUserId" TEXT,
    "storefront" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hasPlaybackRights" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "music_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "music_tracks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "albumName" TEXT,
    "isrc" TEXT,
    "releaseYear" INTEGER,
    "durationMs" INTEGER,
    "artworkUrl" TEXT,
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "music_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "music_track_refs" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "provider" "ProviderKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "previewUrl" TEXT,
    "embeddable" BOOLEAN,
    "matchScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "music_track_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlists" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "PlaylistKind" NOT NULL DEFAULT 'PERSONAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_tracks" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlist_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battles" (
    "id" TEXT NOT NULL,
    "type" "BattleType" NOT NULL,
    "status" "BattleStatus" NOT NULL,
    "visibility" "BattleVisibility" NOT NULL DEFAULT 'PUBLIC',
    "mode" "ChallengeMode" NOT NULL,
    "title" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "genre" TEXT,
    "tagline" TEXT,
    "roundCount" INTEGER NOT NULL,
    "playlistLength" INTEGER,
    "eraFrom" INTEGER,
    "eraTo" INTEGER,
    "votingDurationMs" INTEGER NOT NULL,
    "revealIntervalMs" INTEGER NOT NULL DEFAULT 0,
    "hideTotals" BOOLEAN NOT NULL DEFAULT true,
    "creatorId" TEXT NOT NULL,
    "invitedUserId" TEXT,
    "rematchOfId" TEXT,
    "sentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "lineupDueAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "votingEndsAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" "CancelReason",
    "nextDeadline" TIMESTAMP(3),
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "winnerSide" INTEGER,
    "totalVoters" INTEGER,
    "crowdFavoriteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_participants" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" INTEGER NOT NULL,
    "lineupLockedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_rounds" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "votesA" INTEGER NOT NULL DEFAULT 0,
    "votesB" INTEGER NOT NULL DEFAULT 0,
    "winnerSide" INTEGER,

    CONSTRAINT "battle_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_submissions" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "side" INTEGER NOT NULL,
    "trackId" TEXT,
    "playlistId" TEXT,
    "uploadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "selection" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listen_progress" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playedMs" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listen_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_events" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "roundId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReactionKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follows" (
    "followerId" TEXT NOT NULL,
    "followeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("followerId","followeeId")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "NotificationType" NOT NULL,
    "battleId" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "sourceId" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("userId","badgeId")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "UploadKind" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalName" TEXT,
    "rightsAttestedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles"("username");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_avatarUploadId_key" ON "profiles"("avatarUploadId");

-- CreateIndex
CREATE INDEX "profiles_xp_idx" ON "profiles"("xp");

-- CreateIndex
CREATE UNIQUE INDEX "music_connections_userId_provider_key" ON "music_connections"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "music_tracks_isrc_key" ON "music_tracks"("isrc");

-- CreateIndex
CREATE UNIQUE INDEX "music_track_refs_provider_externalId_key" ON "music_track_refs"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "music_track_refs_trackId_provider_key" ON "music_track_refs"("trackId", "provider");

-- CreateIndex
CREATE INDEX "playlists_ownerId_idx" ON "playlists"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_tracks_playlistId_position_key" ON "playlist_tracks"("playlistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_tracks_playlistId_trackId_key" ON "playlist_tracks"("playlistId", "trackId");

-- CreateIndex
CREATE UNIQUE INDEX "battles_crowdFavoriteId_key" ON "battles"("crowdFavoriteId");

-- CreateIndex
CREATE INDEX "battles_status_nextDeadline_idx" ON "battles"("status", "nextDeadline");

-- CreateIndex
CREATE INDEX "battles_status_visibility_createdAt_idx" ON "battles"("status", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "battles_creatorId_idx" ON "battles"("creatorId");

-- CreateIndex
CREATE INDEX "battles_invitedUserId_idx" ON "battles"("invitedUserId");

-- CreateIndex
CREATE INDEX "battle_participants_userId_idx" ON "battle_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "battle_participants_battleId_userId_key" ON "battle_participants"("battleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "battle_participants_battleId_side_key" ON "battle_participants"("battleId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "battle_rounds_battleId_index_key" ON "battle_rounds"("battleId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "battle_submissions_roundId_side_key" ON "battle_submissions"("roundId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "battle_submissions_battleId_side_trackId_key" ON "battle_submissions"("battleId", "side", "trackId");

-- CreateIndex
CREATE INDEX "votes_battleId_voterId_idx" ON "votes"("battleId", "voterId");

-- CreateIndex
CREATE UNIQUE INDEX "votes_roundId_voterId_key" ON "votes"("roundId", "voterId");

-- CreateIndex
CREATE INDEX "listen_progress_battleId_userId_idx" ON "listen_progress"("battleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "listen_progress_submissionId_userId_key" ON "listen_progress"("submissionId", "userId");

-- CreateIndex
CREATE INDEX "battle_events_battleId_createdAt_idx" ON "battle_events"("battleId", "createdAt");

-- CreateIndex
CREATE INDEX "comments_battleId_createdAt_idx" ON "comments"("battleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_roundId_userId_kind_key" ON "reactions"("roundId", "userId", "kind");

-- CreateIndex
CREATE INDEX "follows_followeeId_idx" ON "follows"("followeeId");

-- CreateIndex
CREATE INDEX "notifications_recipientId_readAt_createdAt_idx" ON "notifications"("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "xp_events_userId_createdAt_idx" ON "xp_events"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "xp_events_userId_kind_sourceId_key" ON "xp_events"("userId", "kind", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "badges_code_key" ON "badges"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_storageKey_key" ON "uploads"("storageKey");

-- CreateIndex
CREATE INDEX "uploads_ownerId_kind_idx" ON "uploads"("ownerId", "kind");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatarUploadId_fkey" FOREIGN KEY ("avatarUploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "music_connections" ADD CONSTRAINT "music_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "music_track_refs" ADD CONSTRAINT "music_track_refs_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "music_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "music_tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_rematchOfId_fkey" FOREIGN KEY ("rematchOfId") REFERENCES "battles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_crowdFavoriteId_fkey" FOREIGN KEY ("crowdFavoriteId") REFERENCES "battle_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_rounds" ADD CONSTRAINT "battle_rounds_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_submissions" ADD CONSTRAINT "battle_submissions_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_submissions" ADD CONSTRAINT "battle_submissions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "battle_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_submissions" ADD CONSTRAINT "battle_submissions_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "battle_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_submissions" ADD CONSTRAINT "battle_submissions_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "music_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_submissions" ADD CONSTRAINT "battle_submissions_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_submissions" ADD CONSTRAINT "battle_submissions_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "battle_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listen_progress" ADD CONSTRAINT "listen_progress_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listen_progress" ADD CONSTRAINT "listen_progress_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "battle_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listen_progress" ADD CONSTRAINT "listen_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_events" ADD CONSTRAINT "battle_events_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "battle_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "battle_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_followeeId_fkey" FOREIGN KEY ("followeeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Move public identity from users to profiles (existing onboarded users keep their handle).
INSERT INTO "profiles" ("userId", "username", "displayName", "bio", "updatedAt")
SELECT "id", "handle", "name", "bio", CURRENT_TIMESTAMP FROM "users" WHERE "handle" IS NOT NULL;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_handle_format";
DROP INDEX "users_handle_key";
ALTER TABLE "users" DROP COLUMN "bio", DROP COLUMN "handle";

-- Integrity rules the app relies on, enforced by the database too.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_username_format" CHECK ("username" ~ '^[a-z0-9_]{3,20}$');
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_display_name_length" CHECK (char_length("displayName") BETWEEN 1 AND 40);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_bio_length" CHECK ("bio" IS NULL OR char_length("bio") <= 160);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_xp_nonnegative" CHECK ("xp" >= 0);

ALTER TABLE "battles" ADD CONSTRAINT "battles_round_count" CHECK ("roundCount" BETWEEN 1 AND 20);
ALTER TABLE "battles" ADD CONSTRAINT "battles_playlist_length" CHECK ("playlistLength" IS NULL OR "playlistLength" BETWEEN 3 AND 10);
ALTER TABLE "battles" ADD CONSTRAINT "battles_voting_duration" CHECK ("votingDurationMs" > 0);
ALTER TABLE "battles" ADD CONSTRAINT "battles_reveal_interval" CHECK ("revealIntervalMs" >= 0);
ALTER TABLE "battles" ADD CONSTRAINT "battles_winner_side" CHECK ("winnerSide" IS NULL OR "winnerSide" IN (0, 1));
ALTER TABLE "battles" ADD CONSTRAINT "battles_era" CHECK ("eraFrom" IS NULL OR "eraTo" IS NULL OR "eraFrom" <= "eraTo");
ALTER TABLE "battles" ADD CONSTRAINT "battles_results_final" CHECK ("status" <> 'COMPLETED' OR ("scoreA" IS NOT NULL AND "scoreB" IS NOT NULL AND "totalVoters" IS NOT NULL));
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_side" CHECK ("side" IN (0, 1));
ALTER TABLE "battle_rounds" ADD CONSTRAINT "battle_rounds_winner_side" CHECK ("winnerSide" IS NULL OR "winnerSide" IN (0, 1));
ALTER TABLE "battle_rounds" ADD CONSTRAINT "battle_rounds_votes" CHECK ("votesA" >= 0 AND "votesB" >= 0);
ALTER TABLE "battle_submissions" ADD CONSTRAINT "battle_submissions_side" CHECK ("side" IN (0, 1));
ALTER TABLE "battle_submissions" ADD CONSTRAINT "battle_submissions_one_entry" CHECK (num_nonnulls("trackId", "playlistId", "uploadId") = 1);
ALTER TABLE "votes" ADD CONSTRAINT "votes_selection" CHECK ("selection" IN (0, 1));
ALTER TABLE "listen_progress" ADD CONSTRAINT "listen_progress_played" CHECK ("playedMs" >= 0);
ALTER TABLE "comments" ADD CONSTRAINT "comments_body_length" CHECK (char_length("body") BETWEEN 1 AND 500);
ALTER TABLE "follows" ADD CONSTRAINT "follows_not_self" CHECK ("followerId" <> "followeeId");
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_size" CHECK ("sizeBytes" > 0);
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_position" CHECK ("position" >= 0);

-- Badge catalog (reference data the app grants by code; kept in sync with apps/web/src/lib/progression.ts)
INSERT INTO "badges" ("id", "code", "name", "description", "icon") VALUES
  ('badge_first_battle', 'FIRST_BATTLE', 'First Battle', 'Finished your first battle.', '🎧'),
  ('badge_first_win', 'FIRST_WIN', 'First Win', 'Won a battle.', '🏆'),
  ('badge_crowd_favorite', 'CROWD_FAVORITE', 'Crowd Favorite', 'Picked the most-voted track of a battle.', '🔥'),
  ('badge_tastemaker', 'TASTEMAKER', 'Tastemaker', 'Voted in 25 rounds.', '🗳️'),
  ('badge_open_door', 'OPEN_DOOR', 'Open Door', 'Took on an open challenge.', '🚪')
ON CONFLICT ("code") DO NOTHING;
