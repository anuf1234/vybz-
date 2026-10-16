import "server-only";
import {
  type Actor,
  type BattleType,
  BATTLE_TYPE_LABELS,
  type Side,
  can,
  eraLabel,
  requiredListenMs,
  revealedRounds,
  roundRevealAt,
  votingDurationLabel,
} from "@vybz/core";
import { prisma } from "@vybz/db";
import {
  type PlaybackSource,
  type TrackProviderRef,
  appleArtworkUrl,
  bestCommonTier,
  resolvePlayback,
  sourceForTier,
} from "@vybz/providers";
import { defaultStorefront, registry } from "../providers";
import { REACTIONS } from "../social/service";
import { storage } from "../uploads/storage";
import { guestViewer } from "../viewer";
import { battles } from "./index";
import { toState } from "./model";

/**
 * Everything a battle page may show, built on the server so nothing secret
 * reaches the browser: lineups stay hidden until their round is revealed,
 * and (with hidden totals) a round's votes only show once you've voted on it.
 */

export interface PlayerView {
  side: Side;
  userId: string;
  username: string;
  displayName: string;
  isYou: boolean;
  lineupLocked: boolean;
}

export interface TrackView {
  title: string;
  artistName: string;
  releaseYear: number | null;
  artworkUrl: string | null;
  externalUrl: string | null;
  source: PlaybackSource | null;
}

export type EntryView =
  | ({ kind: "track"; submissionId: string } & TrackView)
  | { kind: "playlist"; submissionId: string; title: string; tracks: TrackView[] }
  | { kind: "mix"; submissionId: string; title: string; url: string | null };

export interface RoundView {
  index: number;
  revealed: boolean;
  revealAt: Date | null;
  entries: [EntryView | null, EntryView | null];
  myVote: Side | null;
  /** Null while hidden from this viewer. */
  votes: [number, number] | null;
  winnerSide: Side | null;
  reactions: { kind: string; emoji: string; label: string; count: number; mine: boolean }[];
  listened: [number, number];
  requiredMs: number;
}

export type VoteBlock = "SIGN_IN" | "PLAYER" | "NOT_ELIGIBLE" | "CLOSED" | null;

export interface BattleView {
  id: string;
  title: string;
  theme: string;
  genre: string | null;
  tagline: string | null;
  type: BattleType;
  typeLabel: string;
  status: "DRAFT" | "CHALLENGE_SENT" | "ACCEPTED" | "SCHEDULED" | "ACTIVE" | "VOTING" | "COMPLETED" | "CANCELLED";
  cancelReason: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  mode: "DIRECT" | "OPEN" | "MATCHMAKING";
  roundCount: number;
  playlistLength: number | null;
  era: string | null;
  eraFrom: number | null;
  eraTo: number | null;
  votingLabel: string;
  hideTotals: boolean;
  revealIntervalMs: number;
  players: [PlayerView, PlayerView | null];
  invited: { username: string } | null;
  expiresAt: Date | null;
  lineupDueAt: Date | null;
  startsAt: Date | null;
  votingEndsAt: Date | null;
  completedAt: Date | null;
  result: {
    score: [number, number];
    winnerSide: Side | null;
    totalVoters: number;
    totalVotes: [number, number];
    crowdFavorite: { side: Side; roundIndex: number; title: string; subtitle: string; votes: number } | null;
  } | null;
  rounds: RoundView[];
  /** Your own picks, visible to you before they're revealed. */
  myLineup: EntryView[];
  rematchId: string | null;
  rematchOfId: string | null;
  viewer: {
    signedIn: boolean;
    userId: string | null;
    side: Side | null;
    canAccept: boolean;
    canCancel: boolean;
    needsLineup: boolean;
    voteBlock: VoteBlock;
    canComment: boolean;
    followsOpponent: boolean;
  };
}

const entryInclude = {
  track: { include: { refs: true } },
  playlist: { include: { tracks: { orderBy: { position: "asc" }, include: { track: { include: { refs: true } } } } } },
  upload: { select: { id: true, storageKey: true, status: true, originalName: true } },
} as const;

export async function loadBattleView(battleId: string, actor: Actor | null): Promise<BattleView | null> {
  // Lazy advancement: whoever looks at a battle moves it past any passed deadline.
  try {
    await battles.advance(battleId);
  } catch (err) {
    if ((err as { code?: string }).code === "NOT_FOUND") return null;
    throw err;
  }

  const row = await prisma.battle.findUnique({
    where: { id: battleId },
    include: {
      participants: { include: { user: { select: { profile: { select: { username: true, displayName: true } } } } } },
      invitedUser: { select: { profile: { select: { username: true } } } },
      rematches: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
      rounds: {
        orderBy: { index: "asc" },
        include: {
          submissions: { include: entryInclude },
          reactions: { select: { kind: true, userId: true } },
          ...(actor ? { votes: { where: { voterId: actor.id }, select: { selection: true } } } : {}),
        },
      },
    },
  });
  if (!row || row.status === "DRAFT") return null;

  const now = new Date();
  const state = toState({ ...row, participants: row.participants });
  const revealed = revealedRounds(state, now);
  const viewer = guestViewer(defaultStorefront);
  const mySide = actor ? ((row.participants.find((p) => p.userId === actor.id)?.side as Side | undefined) ?? null) : null;
  const done = row.status === "COMPLETED";

  const listens = actor
    ? await prisma.listenProgress.findMany({ where: { battleId, userId: actor.id }, select: { submissionId: true, playedMs: true } })
    : [];

  const player = (side: Side): PlayerView | null => {
    const p = row.participants.find((x) => x.side === side);
    if (!p) return null;
    return {
      side,
      userId: p.userId,
      username: p.user.profile?.username ?? "player",
      displayName: p.user.profile?.displayName ?? "Player",
      isYou: p.userId === actor?.id,
      lineupLocked: Boolean(p.lineupLockedAt),
    };
  };

  const votingOpen = (row.status === "ACTIVE" || row.status === "VOTING") && row.votingEndsAt !== null && now < row.votingEndsAt;
  const gate = actor ? can(actor, { type: "vote.cast" }) : null;
  const voteBlock: VoteBlock = !actor
    ? "SIGN_IN"
    : mySide !== null
      ? "PLAYER"
      : !gate?.allow
        ? "NOT_ELIGIBLE"
        : !votingOpen
          ? "CLOSED"
          : null;

  const myLineup: EntryView[] = [];
  const rounds: RoundView[] = [];
  const totals: [number, number] = [0, 0];
  for (const r of row.rounds) {
    const isRevealed = r.index < revealed;
    const subs = ([0, 1] as const).map((s) => r.submissions.find((x) => x.side === s) ?? null) as [Sub | null, Sub | null];
    // Same kind of playback on both sides, so neither pick wins on presentation.
    const parity = parityTier(subs, viewer);
    const entries = (await Promise.all(subs.map((s) => (s ? entryView(s, parity, viewer) : null)))) as [EntryView | null, EntryView | null];
    if (mySide !== null && entries[mySide]) myLineup.push(entries[mySide]!);

    const myVote = "votes" in r && Array.isArray(r.votes) && r.votes[0] ? (r.votes[0].selection as Side) : null;
    let votes: [number, number] | null = null;
    if (done) votes = [r.votesA, r.votesB];
    else if (isRevealed && (!row.hideTotals ? true : myVote !== null && mySide === null)) votes = await liveCounts(r.id);
    if (done) {
      totals[0] += r.votesA;
      totals[1] += r.votesB;
    }

    rounds.push({
      index: r.index,
      revealed: isRevealed,
      revealAt: roundRevealAt(state, r.index),
      entries: isRevealed ? entries : [null, null],
      myVote,
      votes,
      winnerSide: done ? ((r.winnerSide as Side | null) ?? null) : null,
      reactions: REACTIONS.map((x) => ({
        ...x,
        count: r.reactions.filter((y) => y.kind === x.kind).length,
        mine: actor ? r.reactions.some((y) => y.kind === x.kind && y.userId === actor.id) : false,
      })),
      listened: subs.map((s) => listens.find((l) => l.submissionId === s?.id)?.playedMs ?? 0) as [number, number],
      requiredMs: requiredListenMs(null),
    });
  }

  let crowdFavorite: NonNullable<BattleView["result"]>["crowdFavorite"] = null;
  if (done && row.crowdFavoriteId) {
    for (const r of rounds) {
      const side = ([0, 1] as const).find((s) => r.entries[s]?.submissionId === row.crowdFavoriteId);
      if (side !== undefined) {
        const e = r.entries[side]!;
        crowdFavorite = {
          side,
          roundIndex: r.index,
          title: e.title,
          subtitle: e.kind === "track" ? e.artistName : e.kind === "playlist" ? `${e.tracks.length} tracks` : "DJ mix",
          votes: r.votes?.[side] ?? 0,
        };
      }
    }
  }

  const target = { creatorId: row.creatorId, invitedUserId: row.invitedUserId };
  const opponent = mySide !== null ? row.participants.find((p) => p.side !== mySide) : null;
  const followsOpponent =
    actor && opponent
      ? Boolean(await prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: actor.id, followeeId: opponent.userId } } }))
      : false;

  return {
    id: row.id,
    title: row.title,
    theme: row.theme,
    genre: row.genre,
    tagline: row.tagline,
    type: row.type,
    typeLabel: BATTLE_TYPE_LABELS[row.type],
    status: row.status,
    cancelReason: row.cancelReason,
    visibility: row.visibility,
    mode: row.mode,
    roundCount: row.roundCount,
    playlistLength: row.playlistLength,
    era: eraLabel(row),
    eraFrom: row.eraFrom,
    eraTo: row.eraTo,
    votingLabel: votingDurationLabel(row.votingDurationMs),
    hideTotals: row.hideTotals,
    revealIntervalMs: row.revealIntervalMs,
    players: [player(0)!, player(1)],
    invited: row.invitedUser?.profile ? { username: row.invitedUser.profile.username } : null,
    expiresAt: row.expiresAt,
    lineupDueAt: row.lineupDueAt,
    startsAt: row.startsAt,
    votingEndsAt: row.votingEndsAt,
    completedAt: row.completedAt,
    result: done
      ? {
          score: [row.scoreA ?? 0, row.scoreB ?? 0],
          winnerSide: (row.winnerSide as Side | null) ?? null,
          totalVoters: row.totalVoters ?? 0,
          totalVotes: totals,
          crowdFavorite,
        }
      : null,
    rounds,
    myLineup: row.status === "CANCELLED" ? [] : myLineup,
    rematchId: row.rematches[0]?.id ?? null,
    rematchOfId: row.rematchOfId,
    viewer: {
      signedIn: actor !== null,
      userId: actor?.id ?? null,
      side: mySide,
      canAccept: row.status === "CHALLENGE_SENT" && can(actor, { type: "battle.accept", target }).allow,
      canCancel:
        (row.status === "CHALLENGE_SENT" && (mySide === 0 || (actor !== null && actor.id === row.invitedUserId))) ||
        (row.status === "ACCEPTED" && mySide !== null),
      needsLineup: row.status === "ACCEPTED" && mySide === 1 && !row.participants.find((p) => p.side === 1)?.lineupLockedAt,
      voteBlock,
      canComment: can(actor, { type: "comment.create" }).allow,
      followsOpponent,
    },
  };
}

type Sub = {
  id: string;
  side: number;
  track: (TrackRow & { refs: DbRef[] }) | null;
  playlist: { title: string; tracks: { track: TrackRow & { refs: DbRef[] } }[] } | null;
  upload: { id: string; storageKey: string; status: string; originalName: string | null } | null;
};
type TrackRow = { title: string; artistName: string; releaseYear: number | null; artworkUrl: string | null };
type DbRef = { provider: "APPLE_MUSIC" | "YOUTUBE" | "SPOTIFY"; externalId: string; externalUrl: string | null; previewUrl: string | null; embeddable: boolean | null };

async function liveCounts(roundId: string): Promise<[number, number]> {
  const counts = await prisma.vote.groupBy({ by: ["selection"], where: { roundId }, _count: { _all: true } });
  const out: [number, number] = [0, 0];
  for (const c of counts) out[c.selection as Side] = c._count._all;
  return out;
}

function toRefs(refs: DbRef[]): TrackProviderRef[] {
  return refs
    .filter((r): r is DbRef & { provider: "APPLE_MUSIC" | "YOUTUBE" } => r.provider !== "SPOTIFY")
    .map((r) => ({
      provider: r.provider,
      externalId: r.externalId,
      ...(r.externalUrl ? { externalUrl: r.externalUrl } : {}),
      ...(r.previewUrl ? { previewUrl: r.previewUrl } : {}),
      ...(r.embeddable !== null ? { embeddable: r.embeddable } : {}),
    }));
}

type Viewer = ReturnType<typeof guestViewer>;

/** Votes need a measurable listen, so battle rounds prefer previews both sides share. */
function parityTier(subs: [Sub | null, Sub | null], viewer: Viewer) {
  const [a, b] = subs;
  if (!a?.track || !b?.track) return null;
  const sa = resolvePlayback(toRefs(a.track.refs), viewer, registry).filter((s) => s.tier === "PREVIEW");
  const sb = resolvePlayback(toRefs(b.track.refs), viewer, registry).filter((s) => s.tier === "PREVIEW");
  return bestCommonTier(sa, sb);
}

function trackView(t: TrackRow & { refs: DbRef[] }, viewer: Viewer, tier: ReturnType<typeof bestCommonTier> | "best"): TrackView {
  const sources = resolvePlayback(toRefs(t.refs), viewer, registry);
  const source =
    tier === "best" ? (sources.find((s) => s.tier === "PREVIEW") ?? null) : tier ? sourceForTier(sources, tier) : null;
  const apple = t.refs.find((r) => r.provider === "APPLE_MUSIC");
  return {
    title: t.title,
    artistName: t.artistName,
    releaseYear: t.releaseYear,
    artworkUrl: t.artworkUrl ? appleArtworkUrl(t.artworkUrl, 300) : null,
    externalUrl: apple?.externalUrl ?? null,
    source,
  };
}

async function entryView(s: Sub, parity: ReturnType<typeof bestCommonTier>, viewer: Viewer): Promise<EntryView> {
  if (s.track) return { kind: "track", submissionId: s.id, ...trackView(s.track, viewer, parity ?? "best") };
  if (s.playlist) {
    return { kind: "playlist", submissionId: s.id, title: s.playlist.title, tracks: s.playlist.tracks.map((x) => trackView(x.track, viewer, "best")) };
  }
  const u = s.upload!;
  const url = storage && u.status === "READY" ? await storage.playbackUrl(u.storageKey, u.id) : null;
  return { kind: "mix", submissionId: s.id, title: u.originalName?.replace(/\.[a-z0-9]+$/i, "") || "DJ mix", url };
}
