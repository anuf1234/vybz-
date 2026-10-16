-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('APPLE_MUSIC', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "BattleType" AS ENUM ('SONG');

-- CreateEnum
CREATE TYPE "BattleStatus" AS ENUM ('OPEN', 'PENDING_ACCEPT', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('SUBMISSIONS_OPEN', 'VOTING_OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RoundOutcome" AS ENUM ('VOTES', 'FORFEIT', 'VOID');

-- CreateTable
CREATE TABLE "tracks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "albumName" TEXT,
    "isrc" TEXT,
    "releaseYear" INTEGER,
    "durationMs" INTEGER,
    "artworkUrl" TEXT,
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_provider_refs" (
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

    CONSTRAINT "track_provider_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battles" (
    "id" TEXT NOT NULL,
    "type" "BattleType" NOT NULL DEFAULT 'SONG',
    "status" "BattleStatus" NOT NULL,
    "theme" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "roundCount" INTEGER NOT NULL,
    "creatorId" TEXT NOT NULL,
    "invitedUserId" TEXT,
    "rematchOfId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "winnerSide" INTEGER,
    "nextDeadline" TIMESTAMP(3),
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
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_rounds" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "status" "RoundStatus" NOT NULL,
    "suddenDeath" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "submissionsCloseAt" TIMESTAMP(3) NOT NULL,
    "votingClosesAt" TIMESTAMP(3),
    "winnerSide" INTEGER,
    "outcome" "RoundOutcome",
    "votes0" INTEGER NOT NULL DEFAULT 0,
    "votes1" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "battle_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "side" INTEGER NOT NULL,
    "trackId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "side" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listen_progress" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playedMs" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listen_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracks_isrc_key" ON "tracks"("isrc");

-- CreateIndex
CREATE UNIQUE INDEX "track_provider_refs_provider_externalId_key" ON "track_provider_refs"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "track_provider_refs_trackId_provider_key" ON "track_provider_refs"("trackId", "provider");

-- CreateIndex
CREATE INDEX "battles_status_nextDeadline_idx" ON "battles"("status", "nextDeadline");

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
CREATE UNIQUE INDEX "submissions_roundId_side_key" ON "submissions"("roundId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_battleId_trackId_key" ON "submissions"("battleId", "trackId");

-- CreateIndex
CREATE INDEX "votes_roundId_side_idx" ON "votes"("roundId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "votes_roundId_voterId_key" ON "votes"("roundId", "voterId");

-- CreateIndex
CREATE UNIQUE INDEX "listen_progress_submissionId_userId_key" ON "listen_progress"("submissionId", "userId");

-- AddForeignKey
ALTER TABLE "track_provider_refs" ADD CONSTRAINT "track_provider_refs_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_rematchOfId_fkey" FOREIGN KEY ("rematchOfId") REFERENCES "battles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_rounds" ADD CONSTRAINT "battle_rounds_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "battle_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "battle_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "battle_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listen_progress" ADD CONSTRAINT "listen_progress_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "battle_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listen_progress" ADD CONSTRAINT "listen_progress_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listen_progress" ADD CONSTRAINT "listen_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sides are 0 or 1. Votes can't be cast for a side that doesn't exist.
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_side_check" CHECK ("side" IN (0, 1));
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_side_check" CHECK ("side" IN (0, 1));
ALTER TABLE "votes" ADD CONSTRAINT "votes_side_check" CHECK ("side" IN (0, 1));
ALTER TABLE "battles" ADD CONSTRAINT "battles_winner_side_check" CHECK ("winnerSide" IS NULL OR "winnerSide" IN (0, 1));
ALTER TABLE "battle_rounds" ADD CONSTRAINT "battle_rounds_winner_side_check" CHECK ("winnerSide" IS NULL OR "winnerSide" IN (0, 1));
ALTER TABLE "listen_progress" ADD CONSTRAINT "listen_progress_played_check" CHECK ("playedMs" >= 0);
