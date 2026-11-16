import type { BattleView, EntryView, RoundView } from "@vybz/core";
import * as Haptics from "expo-haptics";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { EntryPlayer } from "@/components/entry-player";
import { Scoreboard } from "@/components/scoreboard";
import { color, radius, space, type } from "@/components/theme";
import { Artwork, Button, Card, ErrorBanner, Loading, Pill, SectionTitle } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { API_URL } from "@/lib/config";
import { STATUS_LABEL, VOTE_REASON, countdown, entryLabel } from "@/lib/format";
import { useNow, useResource } from "@/lib/use-resource";

export default function BattleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  // Poll while open so opponents' picks, votes and deadlines show up.
  const battle = useResource(() => api.battle(id), [id, signedIn], { pollMs: 8_000 });
  const now = useNow(1000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (key: string, fn: () => Promise<BattleView | { id: string }>) => {
      if (!signedIn) return router.push("/sign-in");
      setBusy(key);
      setError(null);
      try {
        const res = await fn();
        if ("rounds" in res) battle.setData(res);
        else router.replace({ pathname: "/battle/[id]", params: { id: res.id } });
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "That didn't work.");
      } finally {
        setBusy(null);
      }
    },
    [signedIn, router, battle],
  );

  const b = battle.data;
  if (!b) {
    return battle.error ? (
      <View style={{ padding: space.lg }}>
        <ErrorBanner message={battle.error.status === 404 ? "This battle doesn't exist." : battle.error.message} onRetry={() => void battle.reload()} />
      </View>
    ) : (
      <Loading />
    );
  }

  const current = b.currentRoundIndex !== null ? b.rounds[b.currentRoundIndex] : undefined;
  const past = b.rounds.filter((r) => r.status === "SCORED").reverse();
  const live = b.status === "IN_PROGRESS";

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={battle.refreshing} onRefresh={() => void battle.reload()} />}
    >
      <Stack.Screen options={{ title: b.title }} />
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
          <Pill text={STATUS_LABEL[b.status]} tone={live ? "live" : b.status === "COMPLETE" ? "violet" : "default"} />
          {b.rules.constraints?.eraFrom ? <Pill text={`${b.rules.constraints.eraFrom}–${b.rules.constraints.eraTo ?? ""}`} /> : null}
          {b.rules.blindVoting ? <Pill text="Blind" /> : null}
        </View>
        <Text style={type.title}>{b.title}</Text>
        {b.theme && b.theme !== b.title ? <Text style={type.small}>{b.theme}</Text> : null}
      </View>

      <Scoreboard battle={b} />
      {error ? <ErrorBanner message={error} /> : null}

      {(b.status === "OPEN_CHALLENGE" || b.status === "PENDING_ACCEPT") && <ChallengePanel b={b} now={now} busy={busy} act={act} />}
      {b.status === "COMPLETE" && <ResultPanel b={b} busy={busy} act={act} />}
      {current && current.status === "SUBMISSIONS_OPEN" && <PickPanel b={b} round={current} now={now} />}
      {current && current.status === "VOTING_OPEN" && (
        <VotingPanel b={b} round={current} now={now} signedIn={signedIn} busy={busy} act={act} reload={() => void battle.reload()} />
      )}

      {past.length ? <SectionTitle>Rounds</SectionTitle> : null}
      {past.map((r) => (
        <ScoredRound key={r.index} b={b} round={r} />
      ))}
    </ScrollView>
  );
}

type Act = (key: string, fn: () => Promise<BattleView | { id: string }>) => Promise<void>;

function ChallengePanel({ b, now, busy, act }: { b: BattleView; now: number; busy: string | null; act: Act }) {
  const left = countdown(b.acceptDeadline, now);
  const share = () =>
    void Share.share({
      message: `I'm calling you out on VYBZ: "${b.title}". ${b.rounds.length} rounds, the crowd decides. ${API_URL}/battle/${b.id}`,
    });
  return (
    <Card>
      <Text style={type.heading}>{b.status === "OPEN_CHALLENGE" ? "Open challenge" : `Waiting for @${b.invited?.handle}`}</Text>
      <Text style={type.small}>
        {b.rounds.length} rounds · {formatWindow(b.rules.timing.submissionWindowMinutes)} to pick, {formatWindow(b.rules.timing.votingWindowMinutes)} to vote
        {left ? ` · expires in ${left}` : ""}
      </Text>
      {b.viewer.canAccept ? <Button title="Accept challenge" onPress={() => void act("accept", () => api.accept(b.id))} loading={busy === "accept"} /> : null}
      {b.viewer.canDecline ? <Button title="Decline" kind="ghost" onPress={() => void act("decline", () => api.decline(b.id))} loading={busy === "decline"} /> : null}
      {b.viewer.canCancel ? (
        <>
          <Button title="Share challenge" kind="secondary" onPress={share} />
          <Button title="Cancel challenge" kind="danger" onPress={() => void act("cancel", () => api.cancel(b.id))} loading={busy === "cancel"} />
        </>
      ) : null}
      {!b.viewer.userId && b.status === "OPEN_CHALLENGE" ? (
        <Link href="/sign-in" asChild>
          <Button title="Sign in to accept" />
        </Link>
      ) : null}
    </Card>
  );
}

function PickPanel({ b, round, now }: { b: BattleView; round: RoundView; now: number }) {
  const left = countdown(round.submissionsCloseAt, now);
  const mine = round.viewer.mySubmission;
  const isParticipant = Boolean(b.viewer.participantId);
  return (
    <Card>
      <View style={styles.panelHead}>
        <Text style={type.heading}>{round.suddenDeath ? "Sudden death" : `Round ${round.index + 1}`} · Picks</Text>
        {left ? <Text style={type.small}>{left} left</Text> : null}
      </View>
      {isParticipant ? (
        mine ? (
          <>
            <TrackRow entryTrack={mine.track} caption="Your pick (sealed)" />
            <Text style={type.small}>{round.viewer.opponentSubmitted ? "Both picks are in. Voting opens now." : "Waiting for your opponent's pick."}</Text>
          </>
        ) : (
          <>
            <Text style={type.body}>{round.viewer.opponentSubmitted ? "Your opponent has picked. Your move." : "Pick a track for this round. Your opponent won't see it until voting opens."}</Text>
            <Link href={{ pathname: "/battle/[id]/pick", params: { id: b.id, round: String(round.index) } }} asChild>
              <Button title="Pick your track" />
            </Link>
          </>
        )
      ) : (
        <Text style={type.body}>Picks are sealed. Voting opens when both are in{left ? ` or in ${left}` : ""}.</Text>
      )}
    </Card>
  );
}

function VotingPanel({
  b,
  round,
  now,
  signedIn,
  busy,
  act,
  reload,
}: {
  b: BattleView;
  round: RoundView;
  now: number;
  signedIn: boolean;
  busy: string | null;
  act: Act;
  reload: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const left = countdown(round.votingClosesAt, now);
  const voted = round.viewer.votedSubmissionId;
  const reason = round.viewer.voteBlockedReason;
  const isParticipant = Boolean(b.viewer.participantId);
  // Listening only matters for people who can vote.
  const reportListens = signedIn && !isParticipant && !voted;

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.panelHead}>
        <Text style={type.heading}>
          {round.suddenDeath ? "Sudden death" : `Round ${round.index + 1}`} · <Text style={{ color: color.live }}>Voting</Text>
        </Text>
        {left ? <Text style={type.small}>{left} left</Text> : null}
      </View>

      {round.entries.map((entry, i) => (
        <EntryCard
          key={entry.submissionId}
          b={b}
          entry={entry}
          label={entryLabel(i)}
          tint={i === 0 ? color.sideA : color.sideB}
          totalVotes={round.totalVotes}
          selected={voted === entry.submissionId}
          mine={round.viewer.mySubmission?.submissionId === entry.submissionId}
        >
          <EntryPlayer
            entry={entry}
            battleId={b.id}
            roundIndex={round.index}
            active={active === entry.submissionId}
            onActivate={() => setActive(entry.submissionId)}
            reportListens={reportListens}
            onListenComplete={reload}
          />
          {!isParticipant && !voted ? (
            <Button
              title={`Vote ${entryLabel(i)}`}
              disabled={!round.viewer.canVote}
              loading={busy === `vote-${entry.submissionId}`}
              onPress={() =>
                void act(`vote-${entry.submissionId}`, async () => {
                  const res = await api.vote(b.id, round.index, entry.submissionId);
                  if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  return res;
                })
              }
            />
          ) : null}
        </EntryCard>
      ))}

      <Text style={[type.small, { textAlign: "center" }]}>
        {voted ? "Vote locked in. Results when the round closes." : reason && !round.viewer.canVote ? VOTE_REASON[reason] : round.viewer.canVote ? "Both heard. Make the call." : ""}
      </Text>
      {!signedIn ? (
        <Link href="/sign-in" asChild>
          <Button title="Sign in to vote" kind="secondary" />
        </Link>
      ) : null}
    </View>
  );
}

function EntryCard({
  b,
  entry,
  label,
  tint,
  totalVotes,
  selected,
  mine,
  children,
}: {
  b: BattleView;
  entry: EntryView;
  label: string;
  tint: string;
  totalVotes: number | null;
  selected: boolean;
  mine: boolean;
  children?: React.ReactNode;
}) {
  const owner = entry.participantId ? b.participants.find((p) => p.id === entry.participantId)?.user : null;
  const share = entry.votes && totalVotes ? Math.round((entry.votes.count / totalVotes) * 100) : null;
  return (
    <View style={[styles.entry, { borderColor: selected ? color.violet : color.line }]}>
      <View style={[styles.entryTag, { backgroundColor: tint }]}>
        <Text style={styles.entryTagText}>{label}</Text>
      </View>
      <TrackRow entryTrack={entry.track} caption={owner ? `@${owner.handle}'s pick` : mine ? "Your pick" : undefined} />
      {share !== null ? (
        <View style={{ gap: 4 }}>
          <View style={styles.shareTrack}>
            <View style={[styles.shareFill, { width: `${share}%`, backgroundColor: tint }]} />
          </View>
          <Text style={type.small}>
            {entry.votes!.count} votes · {share}%
          </Text>
        </View>
      ) : null}
      {selected ? <Pill text="Your vote" tone="violet" /> : null}
      {children}
    </View>
  );
}

function TrackRow({ entryTrack, caption }: { entryTrack: EntryView["track"]; caption?: string | undefined }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
      <Artwork uri={entryTrack.artworkUrl} size={64} />
      <View style={{ flex: 1, gap: 2 }}>
        {caption ? <Text style={type.label}>{caption}</Text> : null}
        <Text style={type.heading} numberOfLines={2}>
          {entryTrack.title}
          {entryTrack.explicit ? " 🅴" : ""}
        </Text>
        <Text style={type.small} numberOfLines={1}>
          {entryTrack.artistName}
          {entryTrack.releaseYear ? ` · ${entryTrack.releaseYear}` : ""}
        </Text>
      </View>
    </View>
  );
}

function ScoredRound({ b, round }: { b: BattleView; round: RoundView }) {
  const winner = round.winnerParticipantId ? b.participants.find((p) => p.id === round.winnerParticipantId) : null;
  const forfeits = round.forfeitParticipantIds.map((pid) => b.participants.find((p) => p.id === pid)?.user.handle).filter(Boolean);
  return (
    <Card style={{ gap: space.sm }}>
      <View style={styles.panelHead}>
        <Text style={type.heading}>{round.suddenDeath ? "Sudden death" : `Round ${round.index + 1}`}</Text>
        <Text style={[type.small, winner && { color: winner.side === 0 ? color.sideA : color.sideB, fontWeight: "700" }]}>
          {winner ? `@${winner.user.handle} wins` : "Draw"}
        </Text>
      </View>
      {forfeits.length ? <Text style={type.small}>No pick from @{forfeits.join(" and @")}</Text> : null}
      {round.entries.map((e) => {
        const owner = b.participants.find((p) => p.id === e.participantId);
        return (
          <View key={e.submissionId} style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
            <Artwork uri={e.track.artworkUrl} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={[type.body, e.participantId === round.winnerParticipantId && { color: color.win }]} numberOfLines={1}>
                {e.track.title}
              </Text>
              <Text style={type.small} numberOfLines={1}>
                {e.track.artistName} · @{owner?.user.handle ?? "?"}
              </Text>
            </View>
            {e.votes ? <Text style={[type.display, { fontSize: 20 }]}>{e.votes.count}</Text> : null}
          </View>
        );
      })}
    </Card>
  );
}

function ResultPanel({ b, busy, act }: { b: BattleView; busy: string | null; act: Act }) {
  const winner = b.winnerParticipantId ? b.participants.find((p) => p.id === b.winnerParticipantId) : null;
  const iWon = winner && winner.id === b.viewer.participantId;
  return (
    <Card style={{ alignItems: "center", borderColor: winner ? color.win : color.line }}>
      <Text style={type.label}>Final</Text>
      <Text style={[type.display, { fontSize: 32, color: winner ? color.win : color.text, textAlign: "center" }]}>
        {winner ? (iWon ? "YOU WIN" : `@${winner.user.handle.toUpperCase()} WINS`) : "DEAD EVEN"}
      </Text>
      {b.viewer.canRematch ? (
        <Button title="Run it back" onPress={() => void act("rematch", () => api.rematch(b.id))} loading={busy === "rematch"} style={{ alignSelf: "stretch" }} />
      ) : null}
    </Card>
  );
}

function formatWindow(min: number): string {
  if (min % (24 * 60) === 0) return `${min / (24 * 60)}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}m`;
}

const styles = StyleSheet.create({
  panelHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  entry: { backgroundColor: color.surface1, borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  entryTag: { position: "absolute", top: -1, right: -1, borderTopRightRadius: radius.lg, borderBottomLeftRadius: radius.md, paddingHorizontal: 12, paddingVertical: 4 },
  entryTagText: { ...type.display, fontSize: 16, color: color.ink },
  shareTrack: { height: 6, borderRadius: 3, backgroundColor: color.surface3, overflow: "hidden" },
  shareFill: { height: 6 },
});
