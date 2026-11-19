import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, Linking, RefreshControl, ScrollView, Text, View } from "react-native";
import { color, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** Staff: approve or reject mixtape links before they go into Daily Drops. */
export default function MixtapeReview() {
  const list = useResource(() => api.modMixtapes(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const review = async (id: string, action: "approve" | "reject") => {
    setBusy(id);
    try {
      await api.modReviewMixtape(id, action);
      await list.reload();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(null);
    }
  };
  const runNow = async () => {
    setBusy("run");
    try {
      const r = await api.modRunDrops();
      setNote(r.ran ? r.note : "Today's drops already ran.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't run it.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Mixtapes and drops" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={list.refreshing} onRefresh={() => void list.reload()} />}>
        <Text style={type.small}>Approve links to music the artist put out publicly. Reject anything that isn't a mixtape, uses a link you can't open, or looks like a leak.</Text>
        <Button title={busy === "run" ? "Running…" : "Gather today's drops now"} kind="secondary" onPress={() => void runNow()} disabled={busy !== null} />
        {note ? <Text style={type.small}>{note}</Text> : null}
        {list.error ? <ErrorBanner message={list.error.message} onRetry={() => void list.reload()} /> : null}
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && !list.data.items.length ? <EmptyState title="Nothing to review" body="New mixtape links show up here." /> : null}
        {list.data?.items.map((m) => (
          <Card key={m.id} style={{ gap: space.sm }}>
            <Text style={[type.body, { fontWeight: "800" }]}>📼 {m.title}</Text>
            <Text style={type.small}>
              {m.artistName}
              {m.submittedBy ? ` · shared by @${m.submittedBy.handle}` : ""}
            </Text>
            {m.note ? <Text style={type.small}>"{m.note}"</Text> : null}
            {m.externalUrl ? (
              <Text style={[type.small, { color: color.violet }]} onPress={() => void Linking.openURL(m.externalUrl!)} accessibilityRole="link">
                Open on {m.host ?? "the web"} ↗
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button title="Approve" style={{ flex: 1 }} disabled={busy !== null} onPress={() => void review(m.id, "approve")} />
              <Button title="Reject" kind="secondary" style={{ flex: 1 }} disabled={busy !== null} onPress={() => void review(m.id, "reject")} />
            </View>
          </Card>
        ))}
      </ScrollView>
    </>
  );
}
