import { Ionicons } from "@expo/vector-icons";
import { TRIVIA_CATEGORY_INFO, type TriviaAnswerResult, type TriviaPlayView, type TriviaQuestionView, type TriviaResult, genreLabel } from "@vybz/core";
import { useAudioPlayer } from "expo-audio";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Loading } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useNow } from "@/lib/use-resource";

interface Shown {
  question: TriviaQuestionView;
  /** Local clock deadline (the server's limit, counted from when we got the question). */
  deadline: number;
}

/** One trivia game: a question at a time against the clock, then the results. */
export default function TriviaGame() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [view, setView] = useState<TriviaPlayView | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [feedback, setFeedback] = useState<{ result: TriviaAnswerResult; choice: number | null } | null>(null);
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = (q: TriviaQuestionView | null) => setShown(q ? { question: q, deadline: Date.now() + q.timeLimitMs - 300 } : null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const v = await api.triviaPlay(id);
      setView(v);
      setScore(v.score);
      show(v.question);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't load the game.");
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  const answer = useCallback(
    async (choice: number | null) => {
      if (!shown || busy || feedback) return;
      setBusy(true);
      try {
        const r = await api.triviaAnswer(id, shown.question.id, choice);
        setScore(r.score);
        setFeedback({ result: r, choice });
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === "NOT_CURRENT_QUESTION") return void load();
        setError(err instanceof ApiRequestError ? err.message : "Couldn't send your answer.");
      } finally {
        setBusy(false);
      }
    },
    [shown, busy, feedback, id, load],
  );

  const next = () => {
    const r = feedback?.result;
    setFeedback(null);
    if (!r) return;
    if (r.finished) void load();
    else show(r.next);
  };

  if (error && !view) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!view) return <Loading />;
  if (view.result && !shown) return <Results result={view.result} />;
  if (!shown) return <Loading />;

  return (
    <>
      <Stack.Screen options={{ title: view.mode === "DAILY" ? "Daily trivia" : "Practice" }} />
      <Question
        key={shown.question.id}
        shown={shown}
        score={score}
        feedback={feedback}
        busy={busy}
        onAnswer={(c) => void answer(c)}
        onNext={next}
        error={error}
      />
    </>
  );
}

function Question({
  shown,
  score,
  feedback,
  busy,
  onAnswer,
  onNext,
  error,
}: {
  shown: Shown;
  score: number;
  feedback: { result: TriviaAnswerResult; choice: number | null } | null;
  busy: boolean;
  onAnswer: (choice: number | null) => void;
  onNext: () => void;
  error: string | null;
}) {
  const q = shown.question;
  const now = useNow(200);
  const left = Math.max(0, shown.deadline - now);
  const fired = useRef(false);
  const player = useAudioPlayer(q.audioUrl ? { uri: q.audioUrl } : null);
  const [playing, setPlaying] = useState(false);

  // Time's up: send a pass so the server moves on.
  useEffect(() => {
    if (left === 0 && !feedback && !fired.current) {
      fired.current = true;
      onAnswer(null);
    }
  }, [left, feedback, onAnswer]);

  useEffect(() => {
    if (feedback && playing) {
      player.pause();
      setPlaying(false);
    }
  }, [feedback, playing, player]);

  const info = TRIVIA_CATEGORY_INFO[q.category];
  const pct = left / q.timeLimitMs;
  const choiceStyle = (i: number) => {
    if (!feedback) return null;
    if (i === feedback.result.answerIndex) return { borderColor: color.win, backgroundColor: "rgba(57,255,136,0.12)" };
    if (i === feedback.choice) return { borderColor: color.danger, backgroundColor: "rgba(255,107,138,0.12)" };
    return { opacity: 0.5 };
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={type.label}>
          Question {q.index + 1} of {q.total}
        </Text>
        <Text style={[type.heading, { fontVariant: ["tabular-nums"] }]}>{score} pts</Text>
      </View>
      <View style={styles.dots}>
        {Array.from({ length: q.total }, (_, i) => (
          <View key={i} style={[styles.dot, i < q.index && { backgroundColor: color.violet }, i === q.index && { backgroundColor: color.violetSoft }]} />
        ))}
      </View>
      <View style={styles.timer} accessibilityRole="progressbar" accessibilityLabel={`${Math.ceil(left / 1000)} seconds left`}>
        <View style={[styles.timerFill, { width: `${pct * 100}%`, backgroundColor: pct > 0.33 ? color.violet : color.danger }]} />
      </View>

      <Text style={type.small}>
        {info.icon} {info.label}
        {q.genre ? ` · ${genreLabel(q.genre)}` : ""}
      </Text>
      {q.imageUrl ? <Image source={{ uri: q.imageUrl }} style={styles.art} contentFit="cover" accessibilityLabel="Album cover" /> : null}
      {q.audioUrl ? (
        <View style={{ gap: space.xs, alignItems: "center" }}>
          <Pressable
            onPress={() => {
              if (playing) player.pause();
              else player.play();
              setPlaying(!playing);
            }}
            style={styles.play}
            accessibilityRole="button"
            accessibilityLabel={playing ? "Pause the clip" : "Play the clip"}
          >
            <Ionicons name={playing ? "pause" : "play"} size={34} color="#fff" />
          </Pressable>
          <Text style={type.small}>Official preview from the music service</Text>
        </View>
      ) : null}
      <Text style={[type.title, { lineHeight: 30 }]}>{q.prompt}</Text>

      <View style={{ gap: space.sm }}>
        {q.choices.map((c, i) => (
          <Pressable
            key={i}
            disabled={!!feedback || busy}
            onPress={() => onAnswer(i)}
            style={({ pressed }) => [styles.choice, pressed && { backgroundColor: color.surface3 }, choiceStyle(i)]}
            accessibilityRole="button"
            accessibilityLabel={c}
          >
            <Text style={[type.body, { fontWeight: "600" }]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      {feedback ? (
        <Card style={{ gap: space.sm }}>
          <Text style={[type.heading, { color: feedback.result.correct ? color.win : color.danger }]}>
            {feedback.result.correct ? `Correct! +${feedback.result.points}` : feedback.result.timedOut ? "Time's up" : "Not quite"}
          </Text>
          {feedback.result.explanation ? <Text style={type.body}>{feedback.result.explanation}</Text> : null}
          <Button title={feedback.result.finished ? "See results" : "Next question"} onPress={onNext} />
        </Card>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
    </ScrollView>
  );
}

function Results({ result: r }: { result: TriviaResult }) {
  const router = useRouter();
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  const flag = (questionId: string) => {
    const send = (reason: string) =>
      void api.triviaFlag(questionId, reason).then(
        () => setFlagged((s) => new Set(s).add(questionId)),
        () => Alert.alert("Couldn't send that", "Try again in a moment."),
      );
    Alert.alert("Report a problem", "What's wrong with this question?", [
      { text: "The answer is wrong", onPress: () => send("The answer is wrong") },
      { text: "It's unclear", onPress: () => send("The question is unclear") },
      { text: "It's out of date", onPress: () => send("It's out of date") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      <Stack.Screen options={{ title: r.mode === "DAILY" ? "Your results" : "Practice results" }} />
      <View style={{ alignItems: "center", gap: space.xs }}>
        <Text style={type.label}>{r.mode === "DAILY" ? `Daily trivia · ${r.day}` : `${r.category ? TRIVIA_CATEGORY_INFO[r.category].label : "Practice"}${r.genre ? ` · ${genreLabel(r.genre)}` : ""}`}</Text>
        <Text style={[type.display, { fontSize: 64 }]}>{r.score}</Text>
        <Text style={type.small}>
          {r.correct} of {r.total} right · max {r.maxScore}
        </Text>
        <View style={{ flexDirection: "row", gap: space.lg, marginTop: space.sm }}>
          {r.reward.xp ? <Text style={[type.heading, { color: color.violetSoft }]}>+{r.reward.xp} XP</Text> : null}
          {r.reward.coins ? <Text style={[type.heading, { color: color.sideB }]}>+{r.reward.coins} coins</Text> : null}
          <Text style={[type.heading, { color: r.streak.current ? color.sideB : color.muted }]}>🔥 {r.streak.current}-day streak</Text>
        </View>
      </View>

      {r.community ? (
        <Card style={{ gap: space.sm }}>
          <Text style={type.label}>You vs the community</Text>
          <Text style={type.title}>{r.community.players > 1 ? `Better than ${r.community.percentile}% of players` : "First to finish today"}</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Stat label="Rank" value={`#${r.community.rank}`} />
            <Stat label="Players" value={String(r.community.players)} />
            <Stat label="Average" value={String(r.community.averageScore)} />
            <Stat label="You" value={String(r.score)} />
          </View>
        </Card>
      ) : null}

      {r.badges.length ? (
        <Card style={{ gap: space.sm }}>
          <Text style={type.label}>Badges unlocked</Text>
          {r.badges.map((b) => (
            <Text key={b.code} style={type.heading}>
              {b.icon} {b.title}
            </Text>
          ))}
        </Card>
      ) : null}

      <Card style={{ gap: space.md, borderColor: color.violet, backgroundColor: color.plum }}>
        <Text style={[type.display, { fontSize: 26 }]}>YOU KNOW MUSIC.</Text>
        <Text style={type.heading}>Can you win a battle?</Text>
        <Text style={type.small}>{r.battleGenre ? `Put your ${genreLabel(r.battleGenre)} knowledge to work: pick the tracks, face the crowd.` : "Pick the tracks, face the crowd, take the win."}</Text>
        <Button title="START BATTLE" onPress={() => router.push({ pathname: "/quick", params: r.battleGenre ? { genre: r.battleGenre } : {} })} />
      </Card>

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button title="Leaderboard" kind="secondary" style={{ flex: 1 }} onPress={() => router.push("/trivia/leaderboard")} />
        <Button title="More trivia" kind="secondary" style={{ flex: 1 }} onPress={() => router.replace("/trivia")} />
      </View>

      <View style={{ gap: space.md }}>
        <Text style={type.label}>Review</Text>
        {r.review.map((q, i) => (
          <Card key={q.questionId} style={{ gap: space.xs }}>
            <Text style={type.small}>
              {i + 1}. {TRIVIA_CATEGORY_INFO[q.category].icon} {q.correct ? `✓ +${q.points}` : "✗"}
              {q.communityCorrectPct !== null ? ` · ${q.communityCorrectPct}% of players got it` : ""}
            </Text>
            {q.imageUrl ? <Image source={{ uri: q.imageUrl }} style={{ width: 72, height: 72, borderRadius: radius.sm }} /> : null}
            <Text style={type.body}>{q.prompt}</Text>
            <Text style={[type.body, { color: color.win, fontWeight: "700" }]}>{q.choices[q.answerIndex]}</Text>
            {!q.correct && q.yourChoice !== null ? <Text style={[type.small, { color: color.danger }]}>You said: {q.choices[q.yourChoice]}</Text> : null}
            {q.explanation ? <Text style={type.small}>{q.explanation}</Text> : null}
            <Pressable onPress={() => flag(q.questionId)} disabled={flagged.has(q.questionId)} hitSlop={8} accessibilityRole="button">
              <Text style={[type.small, { color: flagged.has(q.questionId) ? color.muted : color.violetSoft }]}>{flagged.has(q.questionId) ? "Reported. Thanks." : "Report a problem"}</Text>
            </Pressable>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={[type.title, { fontVariant: ["tabular-nums"] }]}>{value}</Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", gap: 4 },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.surface3 },
  timer: { height: 8, borderRadius: 4, backgroundColor: color.surface2, overflow: "hidden" },
  timerFill: { height: 8, borderRadius: 4 },
  art: { width: 220, height: 220, borderRadius: radius.md, alignSelf: "center" },
  play: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.violet, alignItems: "center", justifyContent: "center" },
  choice: { padding: space.lg, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.line, backgroundColor: color.surface1 },
});
