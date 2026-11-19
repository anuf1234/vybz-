import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, Linking, RefreshControl, ScrollView, Text, View } from "react-native";
import { color, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** Staff: verify artist profiles. Open the proof link and check the post shows the code, from the artist's official account. */
export default function ArtistReview() {
  const list = useResource(() => api.modArtists(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const review = async (id: string, action: "verify" | "reject") => {
    setBusy(id);
    try {
      await api.modReviewArtist(id, action);
      await list.reload();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Stack.Screen options={{ title: "Artist profiles" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={list.refreshing} onRefresh={() => void list.reload()} />}>
        <Text style={type.small}>Verify only when the link is a public post from the artist's official, established account and it shows the exact code.</Text>
        {list.error ? <ErrorBanner message={list.error.message} onRetry={() => void list.reload()} /> : null}
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && !list.data.items.length ? <EmptyState title="Nothing to verify" /> : null}
        {list.data?.items.map((p) => (
          <Card key={p.id} style={{ gap: space.sm }}>
            <Text style={[type.body, { fontWeight: "800" }]}>🎤 {p.name}</Text>
            <Text style={type.small}>Claimed by @{p.owner.handle} · code {p.code}</Text>
            {p.proofUrl ? (
              <Text style={[type.small, { color: color.violetSoft }]} onPress={() => void Linking.openURL(p.proofUrl!)} accessibilityRole="link">
                Open proof ↗
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button title="Verify" style={{ flex: 1 }} disabled={busy !== null} onPress={() => void review(p.id, "verify")} />
              <Button title="Reject" kind="secondary" style={{ flex: 1 }} disabled={busy !== null} onPress={() => void review(p.id, "reject")} />
            </View>
          </Card>
        ))}
      </ScrollView>
    </>
  );
}
