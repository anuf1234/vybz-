import { type DjLessonStepResult, djLesson } from "@vybz/core";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** One DJ University lesson: learn → watch → practise → quiz → XP. */
export default function Lesson() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const lesson = djLesson(id);
  const uni = useResource(() => api.djUniversity(), []);
  const [answers, setAnswers] = useState<(number | null)[]>(() => (lesson ? lesson.quiz.map(() => null) : []));
  const [result, setResult] = useState<DjLessonStepResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      void uni.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  if (!lesson) return <EmptyState title="Lesson not found" />;
  const progress = result?.progress ?? uni.data?.lessons.find((l) => l.id === id)?.progress;

  const step = async (key: string, body: Parameters<typeof api.djLessonStep>[1]) => {
    setBusy(key);
    setError(null);
    try {
      const r = await api.djLessonStep(lesson.id, body);
      setResult(r);
      await uni.reload();
      return r;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That didn't save. Try again.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const openStudio = (mode: "demo" | "practice") =>
    router.push({ pathname: "/dj/studio", params: { path: `/studio?lesson=${lesson.id}&mode=${mode}`, title: mode === "demo" ? "Demo" : "Practice" } });

  const Done = ({ on }: { on?: boolean }) => <Text style={[type.heading, { color: on ? color.win : color.muted }]}>{on ? "✓" : "○"}</Text>;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      <Stack.Screen options={{ title: lesson.course }} />
      <View style={{ gap: space.xs }}>
        <Text style={type.label}>
          Course {lesson.order} of 11 · +{lesson.xp} XP · +{lesson.coins} coins
        </Text>
        <Text style={type.title}>
          {lesson.icon} {lesson.title}
        </Text>
        <Text style={type.small}>{lesson.summary}</Text>
      </View>

      {progress?.completed ? (
        <Card style={{ borderColor: color.win, gap: space.xs }}>
          <Text style={[type.heading, { color: color.win }]}>✓ Lesson complete</Text>
          {result?.reward ? (
            <Text style={type.body}>
              +{result.reward.xp} XP and +{result.reward.coins} coins
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card style={{ gap: space.md }}>
        <View style={styles.stepHead}>
          <Text style={type.label}>1 · Learn</Text>
          <Done on={progress?.learned} />
        </View>
        {lesson.learn.map((s) => (
          <View key={s.heading} style={{ gap: 4 }}>
            <Text style={type.heading}>{s.heading}</Text>
            <Text style={[type.body, { lineHeight: 22 }]}>{s.body}</Text>
          </View>
        ))}
        <View style={{ gap: 4 }}>
          <Text style={type.label}>Key terms</Text>
          {lesson.terms.map((t) => (
            <Text key={t.term} style={type.body}>
              <Text style={{ fontWeight: "800" }}>{t.term}</Text> — {t.meaning}
            </Text>
          ))}
        </View>
        {!progress?.learned ? <Button title="Got it" loading={busy === "learn"} onPress={() => void step("learn", { step: "learn" })} /> : null}
      </Card>

      <Card style={{ gap: space.sm }}>
        <View style={styles.stepHead}>
          <Text style={type.label}>2 · Watch</Text>
          <Done on={progress?.watched} />
        </View>
        <Text style={type.body}>Watch the studio do it, with captions, on the real decks.</Text>
        <Button title="▶ Watch the demo" kind={progress?.watched ? "secondary" : "primary"} onPress={() => openStudio("demo")} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <View style={styles.stepHead}>
          <Text style={type.label}>3 · Practice</Text>
          <Done on={progress?.practiced} />
        </View>
        <Text style={type.heading}>{lesson.practice.goal}</Text>
        <Button title="🎧 Practise in the studio" kind={progress?.practiced ? "secondary" : "primary"} onPress={() => openStudio("practice")} />
      </Card>

      <Card style={{ gap: space.md }}>
        <View style={styles.stepHead}>
          <Text style={type.label}>4 · Quiz</Text>
          <Done on={(progress?.quizScore ?? 0) >= 2} />
        </View>
        {lesson.quiz.map((q, i) => {
          const graded = result?.quiz?.answers[i];
          return (
            <View key={q.prompt} style={{ gap: space.xs }}>
              <Text style={type.heading}>
                {i + 1}. {q.prompt}
              </Text>
              {q.choices.map((c, j) => {
                const picked = answers[i] === j;
                const right = graded && j === graded.answerIndex;
                const wrong = graded && picked && !graded.correct;
                return (
                  <Pressable
                    key={c}
                    onPress={() => {
                      setResult((r) => (r ? { ...r, quiz: undefined } : r));
                      setAnswers((a) => a.map((x, k) => (k === i ? j : x)));
                    }}
                    style={[styles.choice, picked && { borderColor: color.violet, backgroundColor: color.plum }, right && { borderColor: color.win }, wrong && { borderColor: color.danger }]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: picked }}
                  >
                    <Text style={type.body}>{c}</Text>
                  </Pressable>
                );
              })}
              {graded && !graded.correct ? <Text style={type.small}>{graded.explanation}</Text> : null}
            </View>
          );
        })}
        {result?.quiz ? (
          <Text style={[type.heading, { color: result.quiz.passed ? color.win : color.danger }]}>
            {result.quiz.score}/{result.quiz.total} {result.quiz.passed ? "· passed" : "· get 2 right to pass"}
          </Text>
        ) : null}
        <Button
          title="Check answers"
          disabled={answers.some((a) => a === null)}
          loading={busy === "quiz"}
          onPress={() => void step("quiz", { step: "quiz", answers: answers.map((a) => a ?? -1) })}
        />
        {!progress?.completed && (progress?.quizScore ?? 0) >= 2 ? <Text style={type.small}>Finish the steps above to complete the lesson and collect your XP.</Text> : null}
      </Card>

      {error ? <ErrorBanner message={error} /> : null}
      {progress?.completed ? (
        <Card style={{ gap: space.sm, borderColor: color.violet, backgroundColor: color.plum }}>
          <Text style={[type.display, { fontSize: 22 }]}>LEARN → PRACTICE → BATTLE</Text>
          <Text style={type.body}>Record a 30-second to 3-minute battle set and challenge another DJ.</Text>
          <Button title="Record a battle set" onPress={() => router.push({ pathname: "/dj/studio", params: { path: "/studio?lesson=battle-strategy&mode=practice" } })} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stepHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  choice: { padding: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.line, backgroundColor: color.surface1 },
});
