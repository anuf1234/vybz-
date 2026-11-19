import type { ArtistPage } from "@vybz/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { DropCard } from "@/components/drop-card";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, Button, Card, EmptyState, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

const LINK_LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", x: "X", youtube: "YouTube", website: "Website" };

/** An artist's page on VYBZ: verified profile (if claimed), drops, followers, Fan Verdict and war record. */
export default function Artist() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const session = useSession();
  const res = useResource(() => api.artistPage(name ?? ""), [name]);
  const mine = useResource(() => (session.data ? api.myArtistProfile() : Promise.resolve(null)), [session.data?.user.id]);
  const [following, setFollowing] = useState<boolean | null>(null);
  const a = res.data;
  const me = mine.data?.profile?.status === "VERIFIED" ? mine.data.profile : null;
  const isMe = !!(me && a && me.name.toLowerCase() === a.name.toLowerCase());
  const follows = following ?? a?.following ?? false;

  const toggleFollow = async () => {
    if (!session.data) return router.push("/sign-in");
    if (!a) return;
    try {
      if (follows) await api.unfollowArtist({ name: a.name });
      else if (a.releases[0]) await api.followArtist({ releaseId: a.releases[0].id });
      else return Alert.alert("Can't follow yet", "Follow from the artist search once they have music on VYBZ.");
      setFollowing(!follows);
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Try again.");
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: a?.name ?? "Artist" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={res.refreshing} onRefresh={() => void res.reload()} />}>
        {res.error ? <ErrorBanner message={res.error.message} onRetry={() => void res.reload()} /> : null}
        {res.loading && !a ? <Loading /> : null}
        {a ? <Header a={a} follows={follows} onFollow={() => void toggleFollow()} /> : null}
        {a && me && !isMe && a.releases.some((r) => r.kind !== "MIXTAPE") ? (
          <Button title={`⚔️ Challenge ${a.name}`} onPress={() => router.push({ pathname: "/artist/challenge", params: { to: a.name } })} />
        ) : null}
        {a && isMe ? <Button title="⚔️ Challenge another artist" onPress={() => router.push({ pathname: "/artist/challenge", params: {} })} /> : null}
        {a && isMe ? <Button title="Edit bio and links" kind="secondary" onPress={() => router.push("/artist/claim")} /> : null}
        {a && !a.profile && session.data && !mine.data?.profile ? (
          <Pressable onPress={() => router.push({ pathname: "/artist/claim", params: { name: a.name } })} accessibilityRole="link">
            <Text style={[type.small, { color: color.violetSoft, textAlign: "center" }]}>Are you {a.name}? Claim this page ›</Text>
          </Pressable>
        ) : null}

        {a?.wars.recent.length ? (
          <>
            <SectionTitle>Wars</SectionTitle>
            {a.wars.recent.map((w) => (
              <Pressable key={w.id} onPress={() => router.push({ pathname: "/wars/[id]", params: { id: w.id } })} style={{ flexDirection: "row", justifyContent: "space-between", padding: space.sm, borderRadius: radius.md, backgroundColor: color.surface1 }} accessibilityRole="button">
                <Text style={[type.small, { color: color.text, flex: 1 }]} numberOfLines={1}>
                  {w.challenge ? "⚔️ " : ""}
                  {w.title}
                </Text>
                <Text style={[type.small, { fontWeight: "800", color: w.result === "WON" ? color.violetSoft : color.muted }]}>{w.result ?? "Live"}</Text>
              </Pressable>
            ))}
          </>
        ) : null}
        {a ? <SectionTitle>Drops</SectionTitle> : null}
        {a && !a.releases.length ? <EmptyState title="No drops yet" body="New releases from this artist will show up here." /> : null}
        {a?.releases.map((d) => <DropCard key={d.id} drop={d} signedIn={!!session.data} />)}
      </ScrollView>
    </>
  );
}

function Header({ a, follows, onFollow }: { a: ArtistPage; follows: boolean; onFollow: () => void }) {
  const p = a.profile;
  return (
    <Card style={{ gap: space.sm, alignItems: "center" }}>
      <Avatar name={a.name} image={a.releases[0]?.artworkUrl ?? null} size={84} ring={p ? color.violet : undefined} />
      <Text style={type.title}>{a.name}</Text>
      {p ? <Text style={[type.small, { color: color.violetSoft, fontWeight: "800" }]}>✓ Verified on VYBZ · @{p.owner.handle}</Text> : null}
      {p?.bio ? <Text style={[type.small, { textAlign: "center" }]}>{p.bio}</Text> : null}
      {p && Object.keys(p.links).length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md, justifyContent: "center" }}>
          {Object.entries(p.links).map(([k, url]) => (
            <Text key={k} style={[type.small, { color: color.violetSoft }]} onPress={() => void Linking.openURL(url)} accessibilityRole="link">
              {LINK_LABEL[k] ?? k} ↗
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: space.lg, marginTop: space.xs }}>
        <Stat label="Followers" value={String(a.followers)} />
        <Stat label="Fan Verdict" value={a.verdict === null ? "–" : `${a.verdict}%`} />
        <Stat label="War record" value={`${a.wars.won}-${a.wars.lost}`} />
      </View>
      <Button title={follows ? "✓ Following" : "Follow"} kind={follows ? "secondary" : "primary"} onPress={onFollow} />
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={[type.body, { fontWeight: "800" }]}>{value}</Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}
