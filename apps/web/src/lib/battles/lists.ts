import "server-only";
import type { Prisma } from "@vybz/db";
import type { BattleCardData } from "@/components/battle/battle-card";
import type { OpenChallengeData } from "@/components/battle/open-challenge";
import { timeLeft } from "../time";

/** The fields every battle list needs. */
export const cardSelect = {
  id: true,
  title: true,
  theme: true,
  type: true,
  status: true,
  roundCount: true,
  tagline: true,
  mode: true,
  creatorId: true,
  invitedUserId: true,
  expiresAt: true,
  lineupDueAt: true,
  startsAt: true,
  votingEndsAt: true,
  scoreA: true,
  scoreB: true,
  winnerSide: true,
  cancelReason: true,
  invitedUser: { select: { profile: { select: { username: true } } } },
  participants: { select: { side: true, userId: true, lineupLockedAt: true, user: { select: { profile: { select: { username: true } } } } } },
} satisfies Prisma.BattleSelect;

export type CardRow = Prisma.BattleGetPayload<{ select: typeof cardSelect }>;

/** Public battles anyone may see in lists (private ones are link-only). */
export const listedWhere = { visibility: "PUBLIC" } satisfies Prisma.BattleWhereInput;

export function toCard(b: CardRow, viewerId: string | null = null): BattleCardData {
  const name = (side: number) => b.participants.find((p) => p.side === side)?.user.profile?.username ?? null;
  const me = viewerId ? b.participants.find((p) => p.userId === viewerId) : undefined;
  const opp = me ? name(me.side === 0 ? 1 : 0) : null;
  return {
    id: b.id,
    title: b.title,
    theme: b.theme,
    type: b.type,
    status: b.status,
    roundCount: b.roundCount,
    tagline: b.status === "CHALLENGE_SENT" ? b.tagline : null,
    left: name(0) ?? "player",
    right: name(1) ?? b.invitedUser?.profile?.username ?? null,
    line: statusLine(b, viewerId, me?.side ?? null, opp),
    live: b.status === "ACTIVE" || b.status === "VOTING",
    score: b.status === "COMPLETED" ? [b.scoreA ?? 0, b.scoreB ?? 0] : null,
    winnerSide: b.winnerSide,
  };
}

function statusLine(b: CardRow, viewerId: string | null, mySide: number | null, opp: string | null): string {
  switch (b.status) {
    case "DRAFT":
      return "Draft";
    case "CHALLENGE_SENT":
      if (viewerId && b.invitedUserId === viewerId) return `Challenged you · ${b.expiresAt ? timeLeft(b.expiresAt) : ""}`;
      if (mySide === 0) return b.invitedUserId ? "Waiting for them to accept" : "Open challenge, waiting for a taker";
      return `Waiting for an opponent · ${b.expiresAt ? timeLeft(b.expiresAt) : ""}`;
    case "ACCEPTED":
      if (mySide === 1) return `Pick your songs · ${b.lineupDueAt ? timeLeft(b.lineupDueAt) : ""}`;
      return opp ? `@${opp} is picking songs` : "Opponent is picking songs";
    case "SCHEDULED":
      return `Premieres ${b.startsAt ? b.startsAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "soon"}`;
    case "ACTIVE":
      return "Rounds dropping now";
    case "VOTING":
      return `Voting · ${b.votingEndsAt ? timeLeft(b.votingEndsAt) : ""}`;
    case "COMPLETED":
      if (mySide === null) return b.winnerSide === null ? "Draw" : `@${b.participants.find((p) => p.side === b.winnerSide)?.user.profile?.username} won`;
      if (b.winnerSide === null) return `Draw with @${opp}`;
      return b.winnerSide === mySide ? `You beat @${opp}` : `@${opp} won`;
    case "CANCELLED":
      return b.cancelReason === "EXPIRED" ? "Nobody accepted in time" : b.cancelReason === "DECLINED" ? "Declined" : b.cancelReason === "LINEUP_MISSED" ? "Opponent didn't pick in time" : "Called off";
  }
}

/** Public, unclaimed challenges anyone can accept. */
export const openChallengeWhere = (now = new Date()) =>
  ({
    ...listedWhere,
    status: "CHALLENGE_SENT",
    mode: { in: ["OPEN", "MATCHMAKING"] },
    expiresAt: { gt: now },
  }) satisfies Prisma.BattleWhereInput;

export const openChallengeSelect = {
  id: true,
  theme: true,
  tagline: true,
  type: true,
  roundCount: true,
  playlistLength: true,
  expiresAt: true,
  creatorId: true,
  creator: { select: { profile: { select: { username: true, displayName: true } } } },
} satisfies Prisma.BattleSelect;

export function toOpenChallenge(b: Prisma.BattleGetPayload<{ select: typeof openChallengeSelect }>, viewerId: string | null): OpenChallengeData {
  return {
    id: b.id,
    creator: b.creator.profile?.username ?? "player",
    creatorName: b.creator.profile?.displayName ?? "Someone",
    theme: b.theme,
    tagline: b.tagline,
    format: b.type === "SONG_FOR_SONG" ? `${b.roundCount} rounds` : b.type === "PLAYLIST" ? `${b.playlistLength}-track playlist` : "DJ mix",
    expiresIn: b.expiresAt ? timeLeft(b.expiresAt) : "",
    mine: b.creatorId === viewerId,
  };
}
