import type { ReleaseView } from "@vybz/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** A verified artist calls out another artist: one of your releases against one of theirs, as a war. */
export default function Challenge() {
  const params = useLocalSearchParams<{ to?: string }>();
  const router = useRouter();
  const me = useResource(() => api.myArtistProfile(), []);
  const myName = me.data?.profile?.status === "VERIFIED" ? me.data.profile.name : null;
  const mine = useResource(() => (myName ? api.artistPage(myName) : Promise.resolve(null)), [myName]);
  const [to, setTo] = useState(params.to ?? "");
  const [query, setQuery] = useState(params.to ?? "");
  const theirs = useResource(() => (to ? api.artistPage(to) : Promise.resolve(null)), [to]);
  const [a, setA] = useState<ReleaseView | null>(null);
  const [b, setB] = useState<ReleaseView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me.loading && !me.data) return <Loading />;
  if (!myName) return <EmptyState title="Verified artists only" body="Claim and verify your artist profile to challenge other artists." action={<Button title="Claim your profile" onPress={() => router.replace("/artist/claim")} />} />;

  const go = async () => {
    if (!a || !b) return;
    setBusy(true);
    setError(null);
    try {
      const war = await api.challengeArtist(a.id, b.id);
      router.replace({ pathname: "/wars/[id]", params: { id: war.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the challenge.");
    } finally {
      setBusy(false);
    }
  };
  const okKind = (r: ReleaseView) => r.kind !== "MIXTAPE" && (!a || (a.kind === "SINGLE") === (r.kind === "SINGLE"));

  return (
    <>
      <Stack.Screen options={{ title: "Challenge an artist" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={type.small}>Pick one of your releases and one of theirs. Singles face singles; albums and EPs face albums and EPs. Both artists' followers get told, and the fans decide.</Text>
        <SectionTitle>Your release</SectionTitle>
        {mine.data && !mine.data.releases.filter((r) => r.kind !== "MIXTAPE").length ? <Text style={type.small}>None of your releases are in Daily Drops yet.</Text> : null}
        <Picks items={(mine.data?.releases ?? []).filter((r) => r.kind !== "MIXTAPE")} selected={a} onPick={(r) => (setA(r), b && (b.kind === "SINGLE") !== (r.kind === "SINGLE") ? setB(null) : undefined)} />
        <SectionTitle>Who are you calling out?</SectionTitle>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => setTo(query.trim())} placeholder="Artist name" placeholderTextColor={color.muted} style={{ flex: 1, color: color.text, backgroundColor: color.surface2, borderRadius: radius.md, padding: space.md }} accessibilityLabel="Artist to challenge" returnKeyType="search" />
          <Button title="Find" kind="secondary" onPress={() => setTo(query.trim())} />
        </View>
        {theirs.loading && to ? <Loading /> : null}
        {theirs.data ? <Picks items={theirs.data.releases.filter(okKind)} selected={b} onPick={setB} /> : null}
        {theirs.data && !theirs.data.releases.filter(okKind).length ? <Text style={type.small}>No matching releases from {theirs.data.name} in Daily Drops.</Text> : null}
        {error ? <ErrorBanner message={error} /> : null}
        <Button title={busy ? "Starting…" : "⚔️ Start the challenge"} disabled={!a || !b || busy} onPress={() => void go()} />
      </ScrollView>
    </>
  );
}

function Picks({ items, selected, onPick }: { items: ReleaseView[]; selected: ReleaseView | null; onPick: (r: ReleaseView) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
      {items.map((r) => (
        <Pressable key={r.id} onPress={() => onPick(r)} style={{ width: 110, gap: 4, padding: 4, borderRadius: radius.md, borderWidth: 2, borderColor: selected?.id === r.id ? color.violet : "transparent" }} accessibilityRole="button" accessibilityState={{ selected: selected?.id === r.id }} accessibilityLabel={`${r.title}, ${r.kind.toLowerCase()}`}>
          <Cover url={r.artworkUrl} size={100} />
          <Text style={[type.small, { color: color.text, fontWeight: "700" }]} numberOfLines={1}>
            {r.title}
          </Text>
          <Text style={type.small}>{r.kind === "SINGLE" ? "Single" : r.kind === "EP" ? "EP" : "Album"}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
