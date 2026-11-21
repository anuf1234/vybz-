import { type BattleView, type EntryView, type RoundView, type TrackView, battleResultSummary } from "@vybz/core";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { resultCardUrl, shareResult, shareStoryCard } from "@/lib/share-card";
import * as WebBrowser from "expo-web-browser";
import { EntryPlayer } from "@/components/entry-player";
import { LiveStrip } from "@/components/live-strip";
import { SaveButton } from "@/components/save-button";
import { OnboardingNext } from "@/components/onboarding-next";
import { Scoreboard } from "@/components/scoreboard";
import { color, radius, sideColor, space, type } from "@/components/theme";
import { Artwork, Button, Card, ErrorBanner, Loading, Pill, SectionTitle, Segmented } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { API_URL } from "@/lib/config";
import { chooseOption, setPreferredService, usePreferredService } from "@/lib/listen-pref";
import { TIER_LABEL, STATUS_LABEL, VOTE_REASON, countdown, entryLabel, judgingSummary, termsList } from "@/lib/format";
import { useNow, useResource } from "@/lib/use-resource";

export default function BattleScreen() {
  const { id, code } = useLocalSearchParams<{ id: string; code?: string }>();
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  // Poll while open so opponents' picks, votes and deadlines show up.
  const battle = useResource(() => api.battle(id, code), [id, code, signedIn], { pollMs: 8_000 });
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
      <Stack.Screen
        options={{
          title: b.title,
          headerRight: () =>
            b.visibility === "PUBLIC" || b.inviteCode ? (
              <Pressable onPress={() => shareMenu(b)} accessibilityRole="button" accessibilityLabel="Share battle" hitSlop={12} style={{ paddingHorizontal: 8 }}>
                <Text style={{ color: color.text, fontSize: 15, fontWeight: "700" }}>Share</Text>
              </Pressable>
            ) : null,
        }}
      />
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, alignItems: "center" }}>
          <Pill text={b.format === "MULTI" && b.status === "OPEN_CHALLENGE" ? "Lobby" : STATUS_LABEL[b.status]} tone={live ? "live" : b.status === "COMPLETE" ? "violet" : "default"} />
          {b.rules.judging.mode !== "CROWD" ? <Pill text={b.rules.judging.mode === "AI" ? "AI judge" : "Crowd + AI"} tone="violet" /> : null}
          {b.rules.tracksPerRound > 1 ? <Pill text={`${b.rules.tracksPerRound} tracks/round`} /> : null}
          {b.rules.blindVoting ? <Pill text="Blind" /> : null}
        </View>
        <Text style={type.title}>{b.title}</Text>
        {b.theme && b.theme !== b.title ? <Text style={type.small}>{b.theme}</Text> : null}
      </View>

      <Scoreboard battle={b} />
      <OnboardingNext key={b.status} when="trivia" />
      {(b.status === "IN_PROGRESS" || b.status === "COMPLETE") && (b.visibility === "PUBLIC" || b.inviteCode) ? (
        <Pressable
          onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/watch/${b.id}${b.visibility === "PRIVATE" && b.inviteCode ? `?code=${b.inviteCode}` : ""}`)}
          accessibilityRole="link"
          style={{ alignSelf: "center", paddingVertical: 4 }}
        >
          <Text style={[type.small, { color: color.violetSoft, fontWeight: "700" }]}>📺 Watch party: cast it to a TV or show it on your stream</Text>
        </Pressable>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}

      {b.format === "MULTI" && b.status === "OPEN_CHALLENGE" ? (
        <LobbyPanel b={b} now={now} busy={busy} act={act} code={code ?? null} />
      ) : (b.status === "OPEN_CHALLENGE" || b.status === "PENDING_ACCEPT") ? (
        <ChallengePanel b={b} now={now} busy={busy} act={act} code={code ?? null} />
      ) : null}
      {b.status === "COMPLETE" && <ResultPanel b={b} busy={busy} act={act} />}
      {current && current.status === "SUBMISSIONS_OPEN" && <PickPanel b={b} round={current} now={now} />}
      {current && current.status === "VOTING_OPEN" && (
        <VotingPanel b={b} round={current} now={now} signedIn={signedIn} busy={busy} act={act} reload={() => void battle.reload()} />
      )}

      {past.length ? <SectionTitle>Rounds</SectionTitle> : null}
      {past.map((r) => (
        <ScoredRound key={r.index} b={b} round={r} />
      ))}

      {b.status !== "CANCELLED" && b.status !== "EXPIRED" && b.status !== "VOIDED" ? (
        <LiveStrip battleId={b.id} canChat={b.viewer.canChat} isModerator={b.viewer.isModerator} signedIn={signedIn} />
      ) : null}
      <BattleFooter b={b} signedIn={signedIn} busy={busy} act={act} />
    </ScrollView>
  );
}

type Act = (key: string, fn: () => Promise<BattleView | { id: string }>) => Promise<void>;

function inviteLink(b: BattleView): string {
  return `${API_URL}/battle/${b.id}${b.visibility === "PRIVATE" && b.inviteCode ? `?code=${b.inviteCode}` : ""}`;
}

/** Share the story card (an image for Instagram, Snapchat, TikTok…) or the link. Public battles only get the card. */
function shareMenu(b: BattleView) {
  const card = () =>
    void shareStoryCard(b.id)
      .then((ok) => (ok ? undefined : shareBattle(b)))
      .catch(() => Alert.alert("Couldn't make the card", "Try sharing the link instead."));
  if (b.status === "COMPLETE") {
    const me = b.participants.find((p) => p.id === b.viewer.participantId) ?? null;
    const s = battleResultSummary(b, me?.user.handle ?? null);
    void shareResult({ battleId: b.id, as: me?.user.handle ?? null, code: b.visibility === "PRIVATE" ? b.inviteCode : null, message: `${s.headline} ${s.callToAction}` });
    return;
  }
  if (Platform.OS === "web" || b.visibility !== "PUBLIC") return shareBattle(b);
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ["Share story card", "Share link", "Cancel"], cancelButtonIndex: 2, message: "The story card is an image for Instagram, Snapchat, TikTok and Facebook stories." },
      (i) => (i === 0 ? card() : i === 1 ? shareBattle(b) : undefined),
    );
    return;
  }
  Alert.alert("Share battle", "The story card is an image for Instagram, Snapchat, TikTok and Facebook stories.", [
    { text: "Story card", onPress: card },
    { text: "Link", onPress: () => shareBattle(b) },
    { text: "Cancel", style: "cancel" },
  ]);
}

/** A message that fits where the battle is: a result to brag about, a vote to get, or a challenge to take. */
function shareBattle(b: BattleView) {
  const link = inviteLink(b);
  const [x, y] = [...b.participants].sort((p, q) => q.roundsWon - p.roundsWon);
  const winner = b.participants.find((p) => p.id === b.winnerParticipantId);
  let message: string;
  if (b.status === "COMPLETE" && winner && b.format === "DUEL" && x && y) message = `@${winner.user.handle} beat @${(winner.id === x.id ? y : x).user.handle} ${x.roundsWon}–${y.roundsWon} in "${b.title}" on VYBZ. ${link}`;
  else if (b.status === "COMPLETE" && winner) message = `@${winner.user.handle} won "${b.title}" on VYBZ. ${link}`;
  else if (b.status === "IN_PROGRESS") message = `"${b.title}" is live on VYBZ. Listen to both picks and vote: ${link}`;
  else if (b.status === "OPEN_CHALLENGE" && b.format === "DUEL") message = `Think your taste beats mine? Take my VYBZ challenge "${b.title}": ${link}`;
  else message = `"${b.title}" on VYBZ: ${link}`;
  void Share.share({ message });
}

/** Group battles gather entrants until full, the host starts, or the join window closes. */
function LobbyPanel({ b, now, busy, act, code }: { b: BattleView; now: number; busy: string | null; act: Act; code: string | null }) {
  const left = countdown(b.acceptDeadline, now);
  const { joined, min, max } = b.entrants;
  const players = b.participants;
  const share = () =>
    void Share.share({ message: `Join my VYBZ group battle "${b.title}" (${joined}/${max} in). ${inviteLink(b)}` });
  return (
    <Card>
      <View style={styles.panelHead}>
        <Text style={type.heading}>Lobby · {joined}/{max}</Text>
        {left ? <Text style={type.small}>Closes in {left}</Text> : null}
      </View>
      <Text style={type.small}>
        Starts when it's full{b.viewer.canStart ? ", when you start it," : ""} or when the join window closes with at least {min} players.
        {b.visibility === "PRIVATE" ? " Invite only." : ""}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {players.map((p) => (
          <View key={p.id} style={[styles.seat, { borderColor: sideColor(p.side) }]}>
            <Text style={[type.small, { color: color.text }]}>@{p.user.handle}</Text>
          </View>
        ))}
        {Array.from({ length: Math.max(0, max - players.length) }, (_, i) => (
          <View key={`open-${i}`} style={[styles.seat, { borderStyle: "dashed" }]}>
            <Text style={type.small}>Open seat</Text>
          </View>
        ))}
      </View>
      <TermsTable b={b} />
      {b.viewer.canJoin ? <Button title="Join battle" onPress={() => void act("join", () => api.join(b.id, code))} loading={busy === "join"} /> : null}
      {b.viewer.canStart ? <Button title="Start now" onPress={() => void act("start", () => api.start(b.id))} loading={busy === "start"} /> : null}
      {b.viewer.participantId ? <Button title="Invite players" kind="secondary" onPress={share} /> : null}
      {b.viewer.canLeave ? <Button title="Leave" kind="ghost" onPress={() => void act("leave", () => api.leave(b.id))} loading={busy === "leave"} /> : null}
      {b.viewer.canCancel ? <Button title="Cancel battle" kind="danger" onPress={() => void act("cancel", () => api.cancel(b.id))} loading={busy === "cancel"} /> : null}
      {!b.viewer.userId ? (
        <Link href="/sign-in" asChild>
          <Button title="Sign in to join" />
        </Link>
      ) : null}
    </Card>
  );
}

/** Report, plus feature/void for moderators. */
function BattleFooter({ b, signedIn, busy, act }: { b: BattleView; signedIn: boolean; busy: string | null; act: Act }) {
  const [reported, setReported] = useState(false);
  const report = async () => {
    try {
      await api.report({ subjectType: "BATTLE", subjectId: b.id, reason: "Reported from the battle screen" });
      setReported(true);
    } catch (err) {
      Alert.alert("Couldn't send report", err instanceof ApiRequestError ? err.message : "Try again.");
    }
  };
  const confirmVoid = () => {
    if (Platform.OS === "web") return void act("void", () => api.voidBattle(b.id));
    Alert.alert("Void this battle?", "It ends now with no winner. This can't be undone.", [
      { text: "Keep", style: "cancel" },
      { text: "Void", style: "destructive", onPress: () => void act("void", () => api.voidBattle(b.id)) },
    ]);
  };
  if (!signedIn) return null;
  return (
    <View style={{ gap: space.sm, marginTop: space.md }}>
      {b.viewer.isModerator ? (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button
            title={b.featured ? "Unfeature" : "Feature"}
            kind="secondary"
            style={{ flex: 1 }}
            loading={busy === "feature"}
            onPress={() => void act("feature", () => api.feature(b.id, !b.featured))}
          />
          {b.status !== "COMPLETE" && b.status !== "CANCELLED" && b.status !== "VOIDED" ? (
            <Button title="Void" kind="danger" style={{ flex: 1 }} loading={busy === "void"} onPress={confirmVoid} />
          ) : null}
        </View>
      ) : null}
      {b.visibility === "PUBLIC" ? (
        <Link href={{ pathname: "/post/new", params: { battleId: b.id, label: b.title } }} asChild>
          <Button title="Share to feed" kind="secondary" />
        </Link>
      ) : null}
      {!b.viewer.participantId ? (
        <Pressable onPress={() => void report()} disabled={reported} accessibilityRole="button">
          <Text style={[type.small, { textAlign: "center" }]}>{reported ? "Thanks, a moderator will take a look." : "Report this battle"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ChallengePanel({ b, now, busy, act, code }: { b: BattleView; now: number; busy: string | null; act: Act; code: string | null }) {
  const left = countdown(b.acceptDeadline, now);
  const me = b.viewer.userId;
  const iProposed = me !== null && b.terms.proposedBy.id === me;
  const share = () =>
    void Share.share({
      message: `I'm calling you out on VYBZ: "${b.title}". ${b.rounds.length} rounds, the crowd decides. ${inviteLink(b)}`,
    });
  const heading =
    b.status === "OPEN_CHALLENGE"
      ? "Open challenge"
      : b.viewer.canAccept
        ? `@${b.terms.proposedBy.handle} ${b.terms.counterCount ? "sent a counter-offer" : "challenged you"}`
        : iProposed
          ? `Waiting for @${b.terms.awaiting?.handle ?? "opponent"} to answer`
          : `Negotiating terms`;

  return (
    <Card>
      <Text style={type.heading}>{heading}</Text>
      <Text style={type.small}>{b.viewer.canAccept ? "Accept these terms to start, or send back your own." : "The battle starts when both sides agree on the terms."}{left ? ` Expires in ${left}.` : ""}</Text>
      <TermsTable b={b} />
      {b.viewer.canAccept ? <Button title="Accept terms & start" onPress={() => void act("accept", () => api.accept(b.id, code))} loading={busy === "accept"} /> : null}
      {b.viewer.canCounter ? (
        <Link href={{ pathname: "/battle/[id]/counter", params: { id: b.id } }} asChild>
          <Button title="Counter-offer" kind="secondary" />
        </Link>
      ) : null}
      {b.viewer.canDecline ? <Button title="Decline" kind="ghost" onPress={() => void act("decline", () => api.decline(b.id))} loading={busy === "decline"} /> : null}
      {b.viewer.canCancel ? (
        <>
          {b.status === "OPEN_CHALLENGE" ? <Button title="Share challenge" kind="secondary" onPress={share} /> : null}
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

/** The current terms, with anything changed by the latest counter-offer marked. */
function TermsTable({ b }: { b: BattleView }) {
  const now = termsList(b.rules);
  const before = b.terms.previousRules ? Object.fromEntries(termsList(b.terms.previousRules).map((t) => [t.key, t.value])) : null;
  return (
    <View style={styles.terms}>
      {now.map((t) => {
        const was = before?.[t.key];
        const changed = was !== undefined && was !== t.value;
        return (
          <View key={t.key} style={styles.termRow} accessibilityLabel={`${t.label}: ${t.value}${changed ? `, changed from ${was}` : ""}`}>
            <Text style={[type.small, { flex: 1 }]}>{t.label}</Text>
            <View style={{ alignItems: "flex-end", flexShrink: 1 }}>
              <Text style={[type.body, { fontWeight: "700", textAlign: "right" }, changed && { color: color.sideB }]}>{t.value}</Text>
              {changed ? <Text style={[type.small, { fontSize: 11, textDecorationLine: "line-through" }]}>{was}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
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
      <ContendersNote b={b} round={round} />
      {isParticipant ? (
        mine ? (
          <>
            {mine.tracks.map((t, i) => (
              <TrackRow key={t.id} entryTrack={t} caption={mine.tracks.length > 1 ? `Your pick ${i + 1} (sealed)` : "Your pick (sealed)"} />
            ))}
            <Text style={type.small}>{round.viewer.opponentSubmitted ? "All picks are in. Voting opens now." : b.format === "MULTI" ? "Waiting for the other players' picks." : "Waiting for your opponent's pick."}</Text>
          </>
        ) : (
          <>
            <Text style={type.body}>
              {round.viewer.opponentSubmitted ? "Your opponent has picked. Your move." : `Pick ${b.rules.tracksPerRound > 1 ? `${b.rules.tracksPerRound} tracks` : "a track"} for this round. Your opponent won't see ${b.rules.tracksPerRound > 1 ? "them" : "it"} until voting opens.`}
            </Text>
            <Link href={{ pathname: "/battle/[id]/pick", params: { id: b.id, round: String(round.index) } }} asChild>
              <Button title={b.rules.tracksPerRound > 1 ? `Pick your ${b.rules.tracksPerRound} tracks` : "Pick your track"} />
            </Link>
          </>
        )
      ) : (
        <Text style={type.body}>Picks are sealed. Voting opens when {b.format === "MULTI" ? "everyone's" : "both are"} in{left ? ` or in ${left}` : ""}.</Text>
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
  const preferred = usePreferredService();
  const options = round.viewer.playbackOptions;
  const optionIndex = chooseOption(options, preferred);
  const option = options[optionIndex];
  const heardElsewhere = option
    ? round.entries.some((e) => e.tracks.some((t) => t.listen.playedMs > 0 && t.listen.tier !== null && t.listen.tier !== option.tier))
    : false;
  const left = countdown(round.votingClosesAt, now);
  const voted = round.viewer.votedSubmissionId;
  const reason = round.viewer.voteBlockedReason;
  const isParticipant = Boolean(b.viewer.participantId);
  const aiOnly = b.rules.judging.mode === "AI";
  // Listening only matters for people who can vote.
  const reportListens = signedIn && !isParticipant && !voted && !aiOnly;
  const canHeart = signedIn && !isParticipant;

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.panelHead}>
        <Text style={type.heading}>
          {round.suddenDeath ? "Sudden death" : `Round ${round.index + 1}`} · <Text style={{ color: color.live }}>Voting</Text>
        </Text>
        {left ? <Text style={type.small}>{left} left</Text> : null}
      </View>
      <ContendersNote b={b} round={round} />

      {options.length > 1 ? (
        <View style={{ gap: space.xs }}>
          <Text style={type.label}>Listen on</Text>
          <Segmented
            value={String(optionIndex)}
            onChange={(v) => {
              const o = options[Number(v)];
              if (o) {
                setActive(null);
                setPreferredService(o.provider);
              }
            }}
            options={options.map((o, i) => ({ value: String(i), label: `${o.label} · ${o.tier === "PREVIEW" ? "30s" : "Full"}` }))}
          />
          <Text style={type.small}>
            {option ? `Both sides play on ${option.label} (${TIER_LABEL[option.tier].toLowerCase()}), so they're heard the same way.` : ""}
            {heardElsewhere && reportListens ? " Switching services restarts your listening for this round." : ""}
          </Text>
        </View>
      ) : option ? (
        <Text style={type.small}>Playing on {option.label} · {TIER_LABEL[option.tier].toLowerCase()}</Text>
      ) : null}

      {round.entries.map((entry, i) => (
        <EntryCard
          key={entry.submissionId}
          b={b}
          entry={entry}
          label={entryLabel(i)}
          tint={tintFor(b, entry, i)}
          totalVotes={round.totalVotes}
          selected={voted === entry.submissionId}
          mine={round.viewer.mySubmission?.submissionId === entry.submissionId}
        >
          {entry.tracks.map((t, ti) => (
            <View key={t.submissionId} style={{ gap: space.sm }}>
              {entry.tracks.length > 1 ? <TrackRow entryTrack={t.track} caption={`Track ${ti + 1}`} compact saveable /> : null}
              {canHeart ? <HeartButton b={b} round={round} submissionId={t.submissionId} reload={reload} /> : null}
              <EntryPlayer
                key={`${t.submissionId}:${option?.provider ?? "none"}:${option?.tier ?? ""}`}
                entry={t}
                source={t.sources[optionIndex] ?? t.playback}
                minPlayedMs={b.rules.fairListen.minPlayedMs}
                battleId={b.id}
                roundIndex={round.index}
                active={active === t.submissionId}
                onActivate={() => setActive(t.submissionId)}
                reportListens={reportListens}
                onListenComplete={reload}
              />
            </View>
          ))}
          {!isParticipant && !voted && !aiOnly ? (
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
        {voted
          ? `Vote locked in. Results when the round closes.${b.rules.judging.mode === "COMBINED" ? " The AI's pick is added then." : ""}`
          : reason && !round.viewer.canVote
            ? VOTE_REASON[reason]
            : round.viewer.canVote
              ? `All heard. Make the call.${b.rules.judging.mode === "COMBINED" ? ` (The AI counts for ${b.rules.judging.aiWeightPercent}% of this round.)` : ""}`
              : ""}
      </Text>
      {!signedIn && !aiOnly ? (
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
      {entry.tracks.length === 1 ? (
        <TrackRow entryTrack={entry.tracks[0]!.track} caption={owner ? `@${owner.handle}'s pick` : mine ? "Your pick" : undefined} saveable />
      ) : (
        <Text style={type.label}>{owner ? `@${owner.handle}'s set` : mine ? "Your set" : `Set ${label}`}</Text>
      )}
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

function TrackRow({ entryTrack, caption, compact, saveable }: { entryTrack: TrackView; caption?: string | undefined; compact?: boolean; saveable?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
      <Artwork uri={entryTrack.artworkUrl} size={compact ? 44 : 64} />
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
      {saveable ? <SaveButton song={{ trackId: entryTrack.id, title: entryTrack.title }} size={30} /> : null}
    </View>
  );
}

function ScoredRound({ b, round }: { b: BattleView; round: RoundView }) {
  const [replay, setReplay] = useState<string | null>(null);
  const handle = (pid: string | null) => b.participants.find((p) => p.id === pid);
  const winner = handle(round.winnerParticipantId);
  const forfeits = round.forfeitParticipantIds.map((pid) => handle(pid)?.user.handle).filter(Boolean);
  const mode = b.rules.judging.mode;
  const crowd = handle(round.crowdWinnerParticipantId);
  return (
    <Card style={{ gap: space.sm }}>
      <View style={styles.panelHead}>
        <Text style={type.heading}>{round.suddenDeath ? "Sudden death" : `Round ${round.index + 1}`}</Text>
        <Text style={[type.small, winner && { color: sideColor(winner.side), fontWeight: "700" }]}>
          {winner ? `@${winner.user.handle} wins` : "Draw"}
        </Text>
      </View>
      {forfeits.length ? <Text style={type.small}>No pick from @{forfeits.join(" and @")}</Text> : null}
      {round.entries.map((e) => {
        const owner = handle(e.participantId);
        return (
          <View key={e.submissionId} style={{ gap: 6 }}>
            {e.tracks.map((t, i) => (
              <View key={t.submissionId} style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
                <Artwork uri={t.track.artworkUrl} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, e.participantId === round.winnerParticipantId && { color: color.win }]} numberOfLines={1}>
                    {t.track.title}
                  </Text>
                  <Text style={type.small} numberOfLines={1}>
                    {t.track.artistName} · @{owner?.user.handle ?? "?"}
                  </Text>
                </View>
                {t.hearts ? <Text style={type.small}>♥ {t.hearts}</Text> : null}
                <SaveButton song={{ trackId: t.track.id, title: t.track.title }} size={28} />
                {i === 0 && e.votes ? <Text style={[type.display, { fontSize: 20 }]}>{e.votes.count}</Text> : null}
                <Pressable
                  onPress={() => setReplay(replay === t.submissionId ? null : t.submissionId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Replay ${t.track.title}`}
                  hitSlop={8}
                >
                  <Text style={[type.small, { color: color.violet }]}>{replay === t.submissionId ? "Close" : "Replay"}</Text>
                </Pressable>
              </View>
            ))}
            {e.tracks.map((t) =>
              replay === t.submissionId ? (
                <EntryPlayer
                  key={`replay-${t.submissionId}`}
                  entry={t}
                  source={t.playback}
                  minPlayedMs={b.rules.fairListen.minPlayedMs}
                  battleId={b.id}
                  roundIndex={round.index}
                  active
                  onActivate={() => undefined}
                  reportListens={false}
                />
              ) : null,
            )}
          </View>
        );
      })}
      {mode === "COMBINED" || mode === "SEPARATE" ? (
        <Text style={type.small}>
          Crowd: {crowd ? `@${crowd.user.handle}` : "level"} · AI: {round.ai ? `@${handle(round.ai.participantId)?.user.handle ?? "?"}` : "no verdict"}
          {mode === "SEPARATE" ? " · crowd's card is official" : ""}
        </Text>
      ) : null}
      {round.ai ? <AiVerdictCard b={b} ai={round.ai} /> : null}
    </Card>
  );
}

function AiVerdictCard({ b, ai }: { b: BattleView; ai: NonNullable<RoundView["ai"]> }) {
  const pick = b.participants.find((p) => p.id === ai.participantId);
  return (
    <View style={styles.aiCard} accessibilityLabel={`AI judge picked ${pick?.user.handle}: ${ai.reason}`}>
      <Text style={type.label}>
        {ai.model === "demo" ? "Demo judge" : "AI judge"} · picked @{pick?.user.handle ?? "?"} · {Math.round(ai.confidence * 100)}% sure
      </Text>
      <Text style={type.body}>{ai.reason}</Text>
    </View>
  );
}

function ResultPanel({ b, busy, act }: { b: BattleView; busy: string | null; act: Act }) {
  const winner = b.winnerParticipantId ? b.participants.find((p) => p.id === b.winnerParticipantId) : null;
  const iWon = winner && winner.id === b.viewer.participantId;
  const me = b.participants.find((p) => p.id === b.viewer.participantId) ?? null;
  const summary = battleResultSummary(b, me?.user.handle ?? null);
  const code = b.visibility === "PRIVATE" ? b.inviteCode : null;
  // Anyone can share a public result; private ones need the invite code (players have it).
  const shareable = b.visibility === "PUBLIC" || Boolean(code);
  const [sharing, setSharing] = useState(false);
  const share = () => {
    setSharing(true);
    void shareResult({ battleId: b.id, as: me?.user.handle ?? null, code, message: `${summary.headline} ${summary.callToAction}` })
      .catch(() => Alert.alert("Couldn't share", "Try again in a moment."))
      .finally(() => setSharing(false));
  };
  return (
    <Card style={{ alignItems: "center", borderColor: winner ? color.win : color.line }}>
      <Text style={type.label}>Final</Text>
      <Text style={[type.display, { fontSize: 32, color: winner ? color.win : color.text, textAlign: "center" }]}>
        {winner ? (iWon ? "YOU WIN" : `@${winner.user.handle.toUpperCase()} WINS`) : "DEAD EVEN"}
      </Text>
      <Text style={[type.body, { textAlign: "center", fontWeight: "700" }]}>{summary.headline}</Text>
      {shareable ? (
        <Pressable onPress={share} accessibilityRole="button" accessibilityLabel="Share your result card" style={{ alignItems: "center", gap: space.sm, marginTop: space.sm }}>
          <Image source={{ uri: resultCardUrl(b.id, me?.user.handle ?? null, code) }} style={styles.resultCard} contentFit="cover" transition={200} accessibilityIgnoresInvertColors />
        </Pressable>
      ) : null}
      {shareable ? <Button title={me ? "Share your result" : "Share this result"} onPress={share} loading={sharing} style={{ alignSelf: "stretch" }} /> : null}
      {shareable && me ? <Text style={[type.small, { textAlign: "center" }]}>Your friends get the card and a link to take you on.</Text> : null}
      {b.viewer.canRematch && me ? (
        <Button title="Run it back" kind="secondary" onPress={() => void act("rematch", () => api.rematch(b.id))} loading={busy === "rematch"} style={{ alignSelf: "stretch" }} />
      ) : null}
      {b.viewer.userId && !me && summary.challengeHandle ? (
        <Button title={`Take on @${summary.challengeHandle}`} kind="secondary" onPress={() => void act("rematch", () => api.rematch(b.id, { against: summary.challengeHandle, code }))} loading={busy === "rematch"} style={{ alignSelf: "stretch" }} />
      ) : null}
      {b.aiScorecard ? (
        <Text style={type.small}>
          AI's card: {b.participants.map((p) => `@${p.user.handle} ${b.aiScorecard![p.id] ?? 0}`).join(" – ")}
          {b.rules.judging.mode === "SEPARATE" ? " (the crowd's card is official)" : ""}
        </Text>
      ) : null}
      <Text style={type.small}>Judged by: {judgingSummary(b.rules)}</Text>
      {b.stats ? <StatsGrid b={b} /> : null}
    </Card>
  );
}

function tintFor(b: BattleView, entry: EntryView, index: number): string {
  const p = entry.participantId ? b.participants.find((x) => x.id === entry.participantId) : null;
  return sideColor(p ? p.side : index);
}

/** Who's still in it: shown for sudden death and for group rounds. */
function ContendersNote({ b, round }: { b: BattleView; round: RoundView }) {
  if (!round.suddenDeath || round.contenderIds.length === b.participants.length) return null;
  const names = round.contenderIds.map((id) => b.participants.find((p) => p.id === id)?.user.handle).filter(Boolean);
  return <Text style={type.small}>Tie-breaker between @{names.join(", @")}.</Text>;
}

function HeartButton({ b, round, submissionId, reload }: { b: BattleView; round: RoundView; submissionId: string; reload: () => void }) {
  const serverOn = round.viewer.heartedSubmissionIds.includes(submissionId);
  const [on, setOn] = useState(serverOn);
  const toggle = async () => {
    const next = !on;
    setOn(next);
    try {
      await api.heart(b.id, round.index, submissionId, next);
      if (next && Platform.OS !== "web") void Haptics.selectionAsync();
      reload();
    } catch {
      setOn(!next);
    }
  };
  return (
    <Pressable onPress={() => void toggle()} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={on ? "Remove heart" : "Heart this track"} style={styles.heart}>
      <Text style={[type.small, { color: on ? color.live : color.muted }]}>{on ? "♥ Hearted" : "♡ Heart this track"}</Text>
    </Pressable>
  );
}

function StatsGrid({ b }: { b: BattleView }) {
  const s = b.stats!;
  const top = s.topTrack;
  const owner = top ? b.participants.find((p) => p.id === top.participantId) : null;
  const cells: [string, string][] = [
    ["Votes", String(s.totalVotes)],
    ["Voters", String(s.uniqueVoters)],
    ["Listened → voted", `${Math.round(s.completionRate * 100)}%`],
    ["Reactions", String(s.reactions)],
  ];
  return (
    <View style={{ alignSelf: "stretch", gap: space.sm }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {cells.map(([k, v]) => (
          <View key={k} style={styles.stat}>
            <Text style={[type.display, { fontSize: 20 }]}>{v}</Text>
            <Text style={type.small}>{k}</Text>
          </View>
        ))}
      </View>
      {top ? (
        <Text style={[type.small, { textAlign: "center" }]}>
          Most hearted: {top.track.title} by {top.track.artistName} (♥ {top.hearts}{owner ? `, @${owner.user.handle}'s pick` : ""})
        </Text>
      ) : null}
    </View>
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
  resultCard: { width: 216, height: 384, borderRadius: radius.lg, backgroundColor: color.surface2 },
  shareTrack: { height: 6, borderRadius: 3, backgroundColor: color.surface3, overflow: "hidden" },
  shareFill: { height: 6 },
  terms: { borderRadius: radius.md, borderWidth: 1, borderColor: color.line, paddingHorizontal: space.md },
  termRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  seat: { borderWidth: 1, borderColor: color.line, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  heart: { alignSelf: "flex-start", paddingVertical: 4 },
  stat: { flexGrow: 1, flexBasis: "45%", backgroundColor: color.surface2, borderRadius: radius.md, padding: space.md, alignItems: "center" },
  aiCard: { backgroundColor: color.surface2, borderRadius: radius.md, padding: space.md, gap: 4, borderLeftWidth: 3, borderLeftColor: color.violet },
});
