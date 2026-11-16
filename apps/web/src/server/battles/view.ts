import {
  type BattleAggregate,
  type BattleView,
  type AiVerdictView,
  type EntryTrackView,
  type EntryView,
  type PlaybackOption,
  type RoundView,
  aiScorecard,
  awaitingResponseFrom,
  canRespond,
  roundWinner,
  usesCrowd,
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
  TIER_RANK,
  type TrackProviderRef,
  resolvePlayback,
} from "@vybz/providers";
import { NO_CAPS, PROVIDER_LABEL, type PlaybackCaps, toTrackView, viewerContext } from "../catalog";
import { voterFacts } from "./eligibility";

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
  verdicts: (typeof schema.aiVerdict.$inferSelect)[];
  viewer: (typeof schema.user.$inferSelect) | null;
  deploymentVerifiesEmail: boolean;
  now: Date;
  /** What the viewer's device can play (e.g. full Apple Music for subscribers). */
  caps?: PlaybackCaps;
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
  const viewerCtx = viewerContext(d.storefront, d.caps ?? NO_CAPS, viewer?.id ?? null);

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

    // Sources per submission, then the best tier every track in the round shares (playback parity).
    const sourcesBySub = new Map<string, PlaybackSource[]>();
    for (const s of subs) sourcesBySub.set(s.id, resolvePlayback(d.refs.get(s.trackId) ?? [], viewerCtx, d.playback));
    const sides = new Set(subs.map((s) => s.participantId));
    const playbackOptions = sides.size === 2 ? roundOptions([...sourcesBySub.values()]) : [];
    const parityTier = playbackOptions[0]?.tier ?? null;

    const entries: EntryView[] = [];
    if (votingStarted) {
      const order = entryOrder(r.id, agg.rules.blindVoting);
      for (const side of order) {
        const p = agg.participants.find((x) => x.side === side);
        const set = p ? subs.filter((s) => s.participantId === p.id).sort((x, y) => x.position - y.position) : [];
        if (!p || !set.length) continue;
        const tracks: EntryTrackView[] = [];
        for (const s of set) {
          const track = d.tracks.get(s.trackId);
          if (!track) continue;
          const all = sourcesBySub.get(s.id) ?? [];
          const optionSources = playbackOptions.map((o) => all.find((x) => x.provider === o.provider && x.tier === o.tier)!);
          const proof = d.proofs.find((x) => x.roundId === r.id && x.submissionId === s.id);
          const tier = proof?.tier ?? parityTier ?? all[0]?.tier ?? null;
          tracks.push({
            submissionId: s.id,
            track: toTrackView(track),
            playback: optionSources[0] ?? all[0] ?? null,
            sources: optionSources,
            listen: {
              playedMs: proof?.playedMs ?? 0,
              requiredMs: requiredListenMs(agg.rules.fairListen.minPlayedMs, track.durationMs, tier),
              tier: proof?.tier ?? null,
            },
          });
        }
        entries.push({
          submissionId: set[0]!.id,
          tracks,
          participantId: agg.rules.blindVoting && !scored ? null : p.id,
          votes: tallyVisible && usesCrowd(agg.rules.judging.mode) ? { count: tally[p.id]?.count ?? 0, weighted: tally[p.id]?.weighted ?? 0 } : null,
        });
      }
    }

    const verdictRow = scored ? d.verdicts.find((v) => v.roundId === r.id) : undefined;
    const ai: AiVerdictView | null = verdictRow
      ? {
          submissionId: subs.filter((s) => s.participantId === verdictRow.winnerParticipantId).sort((x, y) => x.position - y.position)[0]?.id ?? "",
          participantId: verdictRow.winnerParticipantId,
          confidence: verdictRow.confidence,
          reason: verdictRow.reason,
          model: verdictRow.model,
        }
      : null;

    const mine = me ? subs.filter((s) => s.participantId === me.id).sort((x, y) => x.position - y.position) : [];
    const mineTracks = mine.map((s) => d.tracks.get(s.trackId)).filter((t): t is NonNullable<typeof t> => !!t);
    const isCurrentVoting = cur?.id === r.id && r.status === "VOTING_OPEN";
    const voted = d.votes.find((v) => v.roundId === r.id);
    let voteBlockedReason: RoundView["viewer"]["voteBlockedReason"] = null;
    if (isCurrentVoting) {
      voteBlockedReason = checkVote({
        battle: agg,
        roundIndex: r.index,
        voter: voterFacts(viewer, d.deploymentVerifiesEmail),
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
      totalVotes: tallyVisible && usesCrowd(agg.rules.judging.mode) ? Object.values(tally).reduce((n, t) => n + t.count, 0) : null,
      ai,
      crowdWinnerParticipantId: scored && usesCrowd(agg.rules.judging.mode) && agg.participants.length === 2 ? roundWinner(tally, [agg.participants[0]!.id, agg.participants[1]!.id]) : null,
      viewer: {
        mySubmission: mine.length && mineTracks.length ? { submissionId: mine[0]!.id, tracks: mineTracks.map(toTrackView) } : null,
        opponentSubmitted: me ? subs.some((s) => s.participantId !== me.id) : false,
        votedSubmissionId: voted?.submissionId ?? null,
        canVote: isCurrentVoting && voteBlockedReason === null,
        voteBlockedReason,
        parityTier,
        playbackOptions,
      },
    };
  });

  const canAccept = !!viewer && canRespond(agg, viewer.id, d.now);
  const canDecline = !!viewer && agg.status === "PENDING_ACCEPT" && agg.invitedUserId === viewer.id;
  const canCancel = !!viewer && viewer.id === agg.creatorId && (agg.status === "OPEN_CHALLENGE" || agg.status === "PENDING_ACCEPT");

  let action: ViewerAction = "none";
  const curView = cur ? rounds.find((r) => r.index === cur.index) : undefined;
  if (canAccept) action = "accept";
  else if (me && cur?.status === "SUBMISSIONS_OPEN" && !curView?.viewer.mySubmission) action = "submit";
  else if (me && agg.status === "IN_PROGRESS") action = "wait";
  else if (!me && cur?.status === "VOTING_OPEN" && !curView?.viewer.votedSubmissionId && usesCrowd(agg.rules.judging.mode)) action = "vote";

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
    aiScorecard: (agg.rules.judging.mode === "SEPARATE" || agg.rules.judging.mode === "COMBINED") && agg.participants.length === 2 ? aiScorecard(agg) : null,
    currentRoundIndex: cur?.index ?? null,
    terms: {
      proposedBy: user(agg.proposedByUserId)!,
      awaiting: user(awaitingResponseFrom(agg)),
      previousRules: agg.previousRules,
      counterCount: agg.counterCount,
    },
    rematchOfId: row.rematchOfId,
    rounds,
    viewer: {
      userId: viewer?.id ?? null,
      participantId: me?.id ?? null,
      canAccept,
      canCounter: canAccept,
      canDecline,
      canCancel,
      canRematch: !!me && agg.status === "COMPLETE",
      action,
    },
  };
}

/**
 * Every service the whole round can be heard on, best tier first. For each
 * provider, the best tier that every track offers from it. Picking an option
 * plays all tracks the same way, which keeps the battle fair.
 */
export function roundOptions(lists: PlaybackSource[][]): PlaybackOption[] {
  if (!lists.length) return [];
  const providers = [...new Set(lists.flatMap((l) => l.map((s) => s.provider)))];
  const options: PlaybackOption[] = [];
  for (const provider of providers) {
    let common: PlaybackTier[] | null = null;
    for (const l of lists) {
      const tiers: PlaybackTier[] = l.filter((s) => s.provider === provider && s.tier !== "LINK_OUT").map((s) => s.tier);
      common = common === null ? tiers : common.filter((t: PlaybackTier) => tiers.includes(t));
    }
    const best = [...(common ?? [])].sort((a, b) => TIER_RANK[b] - TIER_RANK[a])[0];
    if (best) options.push({ provider, tier: best, label: PROVIDER_LABEL[provider] });
  }
  return options.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
}
