import { TRIVIA_CATEGORY_INFO, type TriviaAdminQuestion, genreLabel } from "@vybz/core";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner, Loading, Pill } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";

/**
 * Staff: review drafts one at a time. Check the fact, then Approve, Reject or
 * Skip. About ten seconds a question.
 */
export default function TriviaReview() {
  const [queue, setQueue] = useState<TriviaAdminQuestion[] | null>(null);
  const [done, setDone] = useState({ approved: 0, rejected: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setQueue((await api.modTrivia("DRAFT")).items);
    } catch (err) {
      setError(err instanceof ApiRequestError ? (err.status === 403 ? "Moderators only." : err.message) : "Couldn't load drafts.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (error && !queue) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!queue) return <Loading />;
  const q = queue[0];

  const decide = async (status: "APPROVED" | "REJECTED" | "SKIP") => {
    if (!q) return;
    if (status === "SKIP") return setQueue((x) => [...x!.slice(1), x![0]!]);
    setBusy(true);
    setError(null);
    try {
      await api.modTriviaUpdate(q.id, { status });
      setDone((d) => (status === "APPROVED" ? { ...d, approved: d.approved + 1 } : { ...d, rejected: d.rejected + 1 }));
      setQueue((x) => x!.slice(1));
      if (queue.length <= 1) await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
      <Text style={type.small}>
        {queue.length} waiting · {done.approved} approved · {done.rejected} rejected this session
      </Text>
      {!q ? (
        <EmptyState title="All caught up" body="No drafts waiting. New ones arrive every week." />
      ) : (
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
            <Pill text={TRIVIA_CATEGORY_INFO[q.category].label} tone="violet" />
            {q.genre ? <Pill text={genreLabel(q.genre)} /> : null}
            <Pill text={q.source.toLowerCase()} tone={q.source === "AI" ? "warn" : "default"} />
          </View>
          <Text style={[type.title, { lineHeight: 28 }]}>{q.prompt}</Text>
          {q.choices.map((c, i) => (
            <View key={i} style={{ padding: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: i === q.answerIndex ? color.win : color.line }}>
              <Text style={[type.body, i === q.answerIndex && { fontWeight: "800", color: color.win }]}>
                {i === q.answerIndex ? "✓ " : ""}
                {c}
              </Text>
            </View>
          ))}
          {q.explanation ? <Text style={type.small}>Why: {q.explanation}</Text> : null}
          <Text style={[type.small, { color: color.sideB }]}>Is the marked answer definitely right, and are the others definitely wrong? If you're not sure, reject it.</Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button title="✗ Reject" kind="danger" style={{ flex: 1 }} disabled={busy} onPress={() => void decide("REJECTED")} />
            <Button title="Skip" kind="ghost" disabled={busy} onPress={() => void decide("SKIP")} />
            <Button title="✓ Approve" style={{ flex: 1 }} loading={busy} onPress={() => void decide("APPROVED")} />
          </View>
        </Card>
      )}
      {error ? <ErrorBanner message={error} /> : null}
    </ScrollView>
  );
}
