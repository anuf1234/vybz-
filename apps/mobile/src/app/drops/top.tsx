import { DROP_AWARDS, type HeatRow } from "@vybz/core";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { EmptyState, ErrorBanner, Loading, Segmented, SectionTitle } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { api } from "@/lib/api";
import { listenOn } from "@/lib/listen";
import { useResource } from "@/lib/use-resource";
import { useSpotifyEnabled } from "@/lib/config";

type Race = "songsToday" | "songsWeek" | "albumsWeek";

/** The race for Song of the Day, Song of the Week and Album of the Week, and past winners. */
export default function TopDrops() {
  const router = useRouter();
  const res = useResource(() => api.topDrops(), []);
  const [race, setRace] = useState<Race>("songsToday");
  const t = res.data;
  const list = t?.[race] ?? [];
  return (
    <>
      <Stack.Screen options={{ title: "Top charts" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={res.refreshing} onRefresh={() => void res.reload()} />}>
        <Text style={type.small}>The most-played and most-loved new music on VYBZ, updated through the day.</Text>
        <Segmented
          value={race}
          onChange={setRace}
          options={[
            { value: "songsToday", label: "Today" },
            { value: "songsWeek", label: "Songs · week" },
            { value: "albumsWeek", label: "Albums · week" },
          ]}
        />
        {res.error ? <ErrorBanner message={res.error.message} onRetry={() => void res.reload()} /> : null}
        {res.loading && !t ? <Loading /> : null}
        {t && !list.length ? <EmptyState title="Charts are warming up" body="🔥 your favorite drops and pick in This or That." /> : null}
        {list.map((r) => (
          <Row key={r.release.id} r={r} onArtist={() => router.push({ pathname: "/artist/[name]", params: { name: r.release.artistName } })} />
        ))}
        {t?.history.length ? (
          <>
            <SectionTitle>Past winners</SectionTitle>
            {t.history.map((h) => (
              <View key={`${h.award}-${h.period}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Cover url={h.release.artworkUrl} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={type.label}>
                    {DROP_AWARDS[h.award].icon} {DROP_AWARDS[h.award].label} · {h.period}
                  </Text>
                  <Text style={[type.small, { color: color.text }]} numberOfLines={1}>
                    {h.release.title} · {h.release.artistName}
                  </Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function Row({ r, onArtist }: { r: HeatRow; onArtist: () => void }) {
  const spotify = useSpotifyEnabled();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: r.rank === 1 ? color.violet : color.line, backgroundColor: color.surface1 }}>
      <Text style={[type.display, { fontSize: 22, width: 30, textAlign: "right" }]}>{r.rank}</Text>
      <Cover url={r.release.artworkUrl} size={52} />
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: "800" }]} numberOfLines={1}>
          {r.release.title}
        </Text>
        <Text style={[type.small, { color: color.text }]} onPress={onArtist} accessibilityRole="link">
          {r.release.artistName}
        </Text>
        {spotify && r.release.kind !== "MIXTAPE" ? (
          <Text style={[type.small, { color: color.violetSoft }]} onPress={() => void listenOn("spotify", "release", r.release.id)} accessibilityRole="link">
            Spotify ↗
          </Text>
        ) : null}
      </View>
    </View>
  );
}
