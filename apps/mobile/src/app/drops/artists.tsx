import type { ArtistFollowHit, FollowedArtist } from "@vybz/core";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, EmptyState, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** Artists you follow: their new music shows up under Following, and you get a push when they drop. */
export default function Artists() {
  const mine = useResource(() => api.myArtists(), []);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ArtistFollowHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [items, setItems] = useState<FollowedArtist[] | null>(null);
  const list = items ?? mine.data?.items ?? null;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setHits([]);
    const t = setTimeout(() => {
      setSearching(true);
      api
        .searchFollowArtists(term)
        .then((r) => setHits(r.items))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const toggle = async (a: { provider: string; externalId: string; name: string; artworkUrl: string | null }, following: boolean) => {
    try {
      const r = following ? await api.unfollowArtist({ externalId: a.externalId }) : await api.followArtist(a);
      setItems(r.items);
      setHits((h) => h.map((x) => (x.externalId === a.externalId ? { ...x, following: !following } : x)));
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Try again.");
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Artists" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={type.small}>Follow artists to see their new music under Following and get a notification when they drop.</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search artists"
          placeholderTextColor={color.muted}
          autoCorrect={false}
          style={{ color: color.text, backgroundColor: color.surface2, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: color.line }}
          accessibilityLabel="Search artists"
        />
        {searching ? <Loading /> : null}
        {hits.map((a) => (
          <Row key={a.externalId} name={a.name} image={a.artworkUrl} following={a.following} onPress={() => void toggle(a, a.following)} />
        ))}

        <SectionTitle>{`Following${list ? ` (${list.length})` : ""}`}</SectionTitle>
        {mine.error ? <ErrorBanner message={mine.error.message} onRetry={() => void mine.reload()} /> : null}
        {!list ? <Loading /> : null}
        {list && !list.length ? <EmptyState title="No artists yet" body="Search above, or tap + Follow on any drop." /> : null}
        {list?.map((a) => (
          <Row key={a.externalId} name={a.name} image={a.artworkUrl} following onPress={() => void toggle(a, true)} />
        ))}
      </ScrollView>
    </>
  );
}

function Row({ name, image, following, onPress }: { name: string; image: string | null; following: boolean; onPress: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <Avatar name={name} image={image} size={44} />
      <Text style={[type.body, { flex: 1, fontWeight: "700" }]} numberOfLines={1}>
        {name}
      </Text>
      <Pressable
        onPress={onPress}
        style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: following ? color.line : color.violet, backgroundColor: following ? color.surface2 : color.violet }}
        accessibilityRole="button"
        accessibilityLabel={following ? `Unfollow ${name}` : `Follow ${name}`}
      >
        <Text style={[type.small, { color: color.text, fontWeight: "800" }]}>{following ? "Following" : "Follow"}</Text>
      </Pressable>
    </View>
  );
}
