import "server-only";
import {
  type Actor,
  type BattleRules,
  PACE_PRESETS,
  type Side,
  can,
  eraLabel,
  leftSideFor,
  requiredListenMs,
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
import { guestViewer } from "../viewer";
import { parseRules } from "./model";
import { battles } from "./index";

/**
 * What the battle page may show. Built on the server so nothing secret
 * reaches the browser: while a round is being voted on, picks carry no side,
 * and live vote counts stay hidden until the round closes.
 */

export interface Person {
  handle: string;
  name: string;
}

export interface PickView {
  title: string;
  artistName: string;
  releaseYear: number | null;
  artworkUrl: string | null;
  externalUrl: string | null;
  source: PlaybackSource | null;
}

export type RoundView =
  | {
      kind: "closed";
      index: number;
      suddenDeath: boolean;
      outcome: "VOTES" | "FORFEIT" | "VOID";
      winnerSide: Side | null;
      votes: [number, number];
      picks: [PickView | null, PickView | null];
    }
  | {
      kind: "voting";
      index: number;
      suddenDeath: boolean;
      closesAt: Date;
      /** Left and right, in this viewer's order. No sides. */
      cards: Array<PickView & { submissionId: string; playedMs: number; requiredMs: number }>;
      votedFor: string | null;
      /** Why this viewer can't vote, if they can't. */
      voteBlock: "SIGN_IN" | "BATTLER" | "NOT_ELIGIBLE" | null;
    }
  | {
      kind: "picking";
      index: number;
      suddenDeath: boolean;
      closesAt: Date;
      picked: [boolean, boolean];
      myPick: PickView | null;
    };

export interface BattleView {
  id: string;
  theme: string;
  status: "OPEN" | "PENDING_ACCEPT" | "IN_PROGRESS" | "COMPLETE" | "CANCELLED" | "EXPIRED";
  rules: BattleRules;
  ruleSummary: string;
  sides: [Person, Person | null];
  invited: Person | null;
  expiresAt: Date;
  winnerSide: Side | null;
  roundsWon: [number, number];
  totalVotes: [number, number];
  rounds: RoundView[];
  rematchId: string | null;
  rematchOfId: string | null;
  viewer: {
    signedIn: boolean;
    side: Side | null;
    canAccept: boolean;
    canCancel: boolean;
  };
}

export function ruleSummary(rules: BattleRules): string {
  const era = eraLabel(rules);
  return [`${rules.roundCount} rounds`, PACE_PRESETS[rules.pace].label.toLowerCase() + " pace", era]
    .filter(Boolean)
    .join(" · ");
}

export async function loadBattleView(battleId: string, actor: Actor | null): Promise<BattleView | null> {
  // Lazy advancement: whoever looks at a battle moves it past any passed deadline.
  try {
    await battles.advance(battleId);
  } catch (err) {
    if (err instanceof Error && err.name === "BattleError") return null;
    throw err;
  }

  const row = await prisma.battle.findUnique({
    where: { id: battleId },
    include: {
      participants: { include: { user: { select: { handle: true, name: true } } } },
      invitedUser: { select: { handle: true, name: true } },
      rematches: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
      rounds: {
        orderBy: { index: "asc" },
        include: {
          submissions: { include: { track: { include: { refs: true } } } },
          ...(actor
            ? {
                votes: { where: { voterId: actor.id }, select: { side: true } },
                listens: { where: { userId: actor.id }, select: { submissionId: true, playedMs: true } },
              }
            : {}),
        },
      },
    },
  });
  if (!row) return null;

  const rules = parseRules(row.rules);
  const person = (u: { handle: string | null; name: string }): Person => ({ handle: u.handle ?? "unknown", name: u.name });
  const bySide = (s: Side) => row.participants.find((p) => p.side === s);
  const creator = bySide(0)!;
  const challenger = bySide(1);
  const mySide = (actor && (row.participants.find((p) => p.userId === actor.id)?.side as Side | undefined)) ?? null;
  const target = { creatorId: row.creatorId, invitedUserId: row.invitedUserId };
  const viewer = guestViewer(defaultStorefront);

  const roundsWon: [number, number] = [0, 0];
  const totalVotes: [number, number] = [0, 0];

  const rounds = row.rounds.map((r): RoundView => {
    const subFor = (s: Side) => r.submissions.find((x) => x.side === s) ?? null;

    if (r.status === "CLOSED") {
      const votes: [number, number] = [r.votes0, r.votes1];
      if (r.winnerSide !== null && !r.suddenDeath) roundsWon[r.winnerSide as Side]++;
      totalVotes[0] += votes[0];
      totalVotes[1] += votes[1];
      const [a, b] = [subFor(0), subFor(1)];
      return {
        kind: "closed",
        index: r.index,
        suddenDeath: r.suddenDeath,
        outcome: r.outcome ?? "VOID",
        winnerSide: (r.winnerSide as Side | null) ?? null,
        votes,
        picks: [a && pickView(a.track, bestSource(a.track.refs, viewer)), b && pickView(b.track, bestSource(b.track.refs, viewer))],
      };
    }

    if (r.status === "VOTING_OPEN") {
      const [a, b] = [subFor(0)!, subFor(1)!];
      // Same kind of playback on both sides, so neither pick wins on presentation.
      // Votes need a measurable listen, so voting rounds use the preview clips.
      const [sa, sb] = [previewSources(a.track.refs, viewer), previewSources(b.track.refs, viewer)];
      const tier = bestCommonTier(sa, sb);
      const left = leftSideFor(actor?.id ?? "guest", r.id);
      const ordered = left === 0 ? [a, b] : [b, a];
      const listens = "listens" in r ? (r.listens as { submissionId: string; playedMs: number }[]) : [];
      const myVote = "votes" in r ? (r.votes as { side: number }[])[0] : undefined;
      const voteBlock = !actor
        ? "SIGN_IN"
        : mySide !== null
          ? "BATTLER"
          : !can(actor, { type: "vote.cast" }).allow
            ? "NOT_ELIGIBLE"
            : null;
      return {
        kind: "voting",
        index: r.index,
        suddenDeath: r.suddenDeath,
        closesAt: r.votingClosesAt!,
        cards: ordered.map((s) => {
          const sources = s === a ? sa : sb;
          return {
            ...pickView(s.track, tier ? sourceForTier(sources, tier) : null),
            submissionId: s.id,
            playedMs: listens.find((l) => l.submissionId === s.id)?.playedMs ?? 0,
            requiredMs: requiredListenMs(s.track.durationMs),
          };
        }),
        votedFor: myVote ? (myVote.side === a.side ? a.id : b.id) : null,
        voteBlock,
      };
    }

    const mine = mySide !== null ? subFor(mySide) : null;
    return {
      kind: "picking",
      index: r.index,
      suddenDeath: r.suddenDeath,
      closesAt: r.submissionsCloseAt,
      picked: [Boolean(subFor(0)), Boolean(subFor(1))],
      myPick: mine ? pickView(mine.track, bestSource(mine.track.refs, viewer)) : null,
    };
  });

  return {
    id: row.id,
    theme: row.theme,
    status: row.status,
    rules,
    ruleSummary: ruleSummary(rules),
    sides: [person(creator.user), challenger ? person(challenger.user) : null],
    invited: row.invitedUser ? person(row.invitedUser) : null,
    expiresAt: row.expiresAt,
    winnerSide: (row.winnerSide as Side | null) ?? null,
    roundsWon,
    totalVotes,
    rounds,
    rematchId: row.rematches[0]?.id ?? null,
    rematchOfId: row.rematchOfId,
    viewer: {
      signedIn: actor !== null,
      side: mySide,
      canAccept:
        (row.status === "OPEN" || row.status === "PENDING_ACCEPT") && can(actor, { type: "battle.accept", target }).allow,
      canCancel:
        (row.status === "OPEN" || row.status === "PENDING_ACCEPT") && can(actor, { type: "battle.cancel", target }).allow,
    },
  };
}

type DbRef = {
  provider: "APPLE_MUSIC" | "YOUTUBE";
  externalId: string;
  externalUrl: string | null;
  previewUrl: string | null;
  embeddable: boolean | null;
};

function toRefs(refs: DbRef[]): TrackProviderRef[] {
  return refs.map((r) => ({
    provider: r.provider,
    externalId: r.externalId,
    ...(r.externalUrl ? { externalUrl: r.externalUrl } : {}),
    ...(r.previewUrl ? { previewUrl: r.previewUrl } : {}),
    ...(r.embeddable !== null ? { embeddable: r.embeddable } : {}),
  }));
}

function bestSource(refs: DbRef[], viewer: ReturnType<typeof guestViewer>): PlaybackSource | null {
  return resolvePlayback(toRefs(refs), viewer, registry).find((s) => s.tier !== "LINK_OUT") ?? null;
}

function previewSources(refs: DbRef[], viewer: ReturnType<typeof guestViewer>): PlaybackSource[] {
  return resolvePlayback(toRefs(refs), viewer, registry).filter((s) => s.tier === "PREVIEW");
}

function pickView(
  t: { title: string; artistName: string; releaseYear: number | null; artworkUrl: string | null; refs: DbRef[] },
  source: PlaybackSource | null,
): PickView {
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
