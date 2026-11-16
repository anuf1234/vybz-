import {
  type BattleAggregate,
  type BattleView,
  type EntryView,
  type RoundView,
  type UserSummary,
  type ViewerAction,
  checkVote,
  currentRound,
  entryOrder,
  participantFor,
  requiredListenMs,
  standings,
  submissionsFor,
} from "@vybz/core";
import type { schema } from "@vybz/db";
import {
  type PlaybackSource,
  type PlaybackTier,
  type ProviderRegistry,
  type TrackProviderRef,
  bestCommonTier,
  resolvePlayback,
  sourceForTier,
} from "@vybz/providers";
import { guestViewer, toTrackView } from "../catalog";

/**
 * Builds what one viewer may see of a battle. Visibility rules live here:
 *  - sealed picks: an opponent's pick stays hidden until voting opens;
 *  - blind voting: who picked what stays hidden until the round is scored;
 *  - tallies: shown per the battle's revealTallies rule;
 *  - playback parity: both entries play at the best tier they share for this viewer.
 */

export interface ViewData {
  agg: BattleAggregate;
  row: typeof schema.battle.$inferSelect;
  users: Map<string, UserSummary>;
  tracks: Map<string, typeof schema.track.$inferSelect>;
  refs: Map<string, TrackProviderRef[]>;
  proofs: { roundId: string; submissionId: string; playedMs: number; tier: PlaybackTier }[];
  votes: { roundId: string; submissionId: string }[];
  viewer: (typeof schema.user.$inferSelect) | null;
  now: Date;
  playback: ProviderRegistry;
  storefront: string;
}

const UNKNOWN_USER: UserSummary = { id: "", handle: "unknown", displayName: "Unknown", image: null };

export function buildBattleView(d: ViewData): BattleView {
  const { agg, row, viewer } = d;
  const user = (id: string | null) => (id ? (d.users.get(id) ?? { ...UNKNOWN_USER, id }) : null);
  const me = participantFor(agg, viewer?.id);
  const cur = currentRound(agg);
  const won = agg.participants.length === 2 ? standings(agg).roundsWon : {};
  const viewerCtx = guestViewer(d.storefront); // TODO(musickit): include the viewer's connected providers

  const rounds: RoundView[] = agg.rounds.map((r) => {
    const subs = submissionsFor(agg, r.id);
    const votingStarted = r.status === "VOTING_OPEN" || r.status === "SCORED";
    const scored = r.status === "SCORED";
    const tallyVisible =
      votingStarted &&
      (agg.rules.revealTallies === "LIVE" ||
        (agg.rules.revealTallies === "AT_ROUND_CLOSE" && scored) ||
        (agg.rules.revealTallies === "AT_BATTLE_END" && agg.status === "COMPLETE"));
    const tally = agg.tallies[r.id] ?? {};

    // Sources per submission, then the parity tier both share.
    const sourcesBySub = new Map<string, PlaybackSource[]>();
    for (const s of subs) sourcesBySub.set(s.id, resolvePlayback(d.refs.get(s.trackId) ?? [], viewerCtx, d.playback));
    const [a, b] = subs;
    const parityTier = a && b ? bestCommonTier(sourcesBySub.get(a.id) ?? [], sourcesBySub.get(b.id) ?? []) : null;

    const entries: EntryView[] = [];
    if (votingStarted) {
      const order = entryOrder(r.id, agg.rules.blindVoting);
      const bySide = (side: 0 | 1) => {
        const p = agg.participants.find((x) => x.side === side);
        return p ? subs.find((s) => s.participantId === p.id) : undefined;
      };
      for (const side of order) {
        const s = bySide(side);
        if (!s) continue;
        const track = d.tracks.get(s.trackId);
        if (!track) continue;
        const sources = sourcesBySub.get(s.id) ?? [];
        const proof = d.proofs.find((p) => p.roundId === r.id && p.submissionId === s.id);
        const tier = parityTier ?? proof?.tier ?? sources[0]?.tier ?? null;
        entries.push({
          submissionId: s.id,
          track: toTrackView(track),
          participantId: agg.rules.blindVoting && !scored ? null : s.participantId,
          playback: (parityTier ? sourceForTier(sources, parityTier) : null) ?? sources[0] ?? null,
          votes: tallyVisible ? { count: tally[s.participantId]?.count ?? 0, weighted: tally[s.participantId]?.weighted ?? 0 } : null,
          listen: {
            playedMs: proof && (!parityTier || proof.tier === parityTier) ? proof.playedMs : 0,
            requiredMs: requiredListenMs(agg.rules.fairListen.minPlayedMs, track.durationMs, tier),
            tier: parityTier,
          },
        });
      }
    }

    const mine = me ? subs.find((s) => s.participantId === me.id) : undefined;
    const mineTrack = mine ? d.tracks.get(mine.trackId) : undefined;
    const isCurrentVoting = cur?.id === r.id && r.status === "VOTING_OPEN";
    const voted = d.votes.find((v) => v.roundId === r.id);
    let voteBlockedReason: RoundView["viewer"]["voteBlockedReason"] = null;
    if (isCurrentVoting) {
      voteBlockedReason = checkVote({
        battle: agg,
        roundIndex: r.index,
        voter: viewer ? { userId: viewer.id, emailVerified: viewer.emailVerified, createdAt: viewer.createdAt, status: viewer.status } : null,
        alreadyVoted: Boolean(voted),
        proofs: d.proofs.filter((p) => p.roundId === r.id),
        submissions: subs.map((s) => ({ submissionId: s.id, durationMs: d.tracks.get(s.trackId)?.durationMs ?? null })),
        now: d.now,
      });
      if (!parityTier && voteBlockedReason === "LISTEN_REQUIRED") voteBlockedReason = "TIER_MISMATCH";
    }

    return {
      index: r.index,
      status: r.status,
      suddenDeath: r.suddenDeath,
      submissionsCloseAt: r.submissionsCloseAt?.toISOString() ?? null,
      votingClosesAt: r.votingClosesAt?.toISOString() ?? null,
      winnerParticipantId: r.winnerParticipantId,
      forfeitParticipantIds: r.forfeitParticipantIds,
      entries,
      totalVotes: tallyVisible ? Object.values(tally).reduce((n, t) => n + t.count, 0) : null,
      viewer: {
        mySubmission: mine && mineTrack ? { submissionId: mine.id, track: toTrackView(mineTrack) } : null,
        opponentSubmitted: me ? subs.some((s) => s.participantId !== me.id) : false,
        votedSubmissionId: voted?.submissionId ?? null,
        canVote: isCurrentVoting && voteBlockedReason === null,
        voteBlockedReason,
        parityTier,
      },
    };
  });

  const acceptOpen = !agg.acceptDeadline || agg.acceptDeadline > d.now;
  const canAccept =
    !!viewer &&
    acceptOpen &&
    viewer.id !== agg.creatorId &&
    ((agg.status === "OPEN_CHALLENGE") || (agg.status === "PENDING_ACCEPT" && agg.invitedUserId === viewer.id));
  const canDecline = !!viewer && agg.status === "PENDING_ACCEPT" && agg.invitedUserId === viewer.id;
  const canCancel = !!viewer && viewer.id === agg.creatorId && (agg.status === "OPEN_CHALLENGE" || agg.status === "PENDING_ACCEPT");

  let action: ViewerAction = "none";
  const curView = cur ? rounds.find((r) => r.index === cur.index) : undefined;
  if (canAccept) action = "accept";
  else if (me && cur?.status === "SUBMISSIONS_OPEN" && !curView?.viewer.mySubmission) action = "submit";
  else if (me && agg.status === "IN_PROGRESS") action = "wait";
  else if (!me && cur?.status === "VOTING_OPEN" && !curView?.viewer.votedSubmissionId) action = "vote";

  return {
    id: agg.id,
    title: row.title,
    theme: row.theme,
    status: agg.status,
    rules: agg.rules,
    createdAt: row.createdAt.toISOString(),
    startedAt: agg.startedAt?.toISOString() ?? null,
    endedAt: agg.endedAt?.toISOString() ?? null,
    acceptDeadline: agg.acceptDeadline?.toISOString() ?? null,
    creator: user(agg.creatorId)!,
    invited: user(agg.invitedUserId),
    participants: agg.participants.map((p) => ({ id: p.id, side: p.side, user: user(p.userId)!, roundsWon: won[p.id] ?? 0 })),
    winnerParticipantId: agg.winnerParticipantId,
    currentRoundIndex: cur?.index ?? null,
    rematchOfId: row.rematchOfId,
    rounds,
    viewer: {
      userId: viewer?.id ?? null,
      participantId: me?.id ?? null,
      canAccept,
      canDecline,
      canCancel,
      canRematch: !!me && agg.status === "COMPLETE",
      action,
    },
  };
}
