import { DROP_AWARDS, HEAT, type HeatRow } from "@vybz/core";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { statLine } from "@/components/drop-awards";
import { color, radius, space, type } from "@/components/theme";
import { EmptyState, ErrorBanner, Loading, Segmented, SectionTitle } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { api } from "@/lib/api";
import { listenOn } from "@/lib/listen";
import { useResource } from "@/lib/use-resource";

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
      <Stack.Screen options={{ title: "Top drops" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={res.refreshing} onRefresh={() => void res.reload()} />}>
        <Text style={type.small}>
          Heat = 🔥 fires ×{HEAT.fire} + This-or-That wins ×{HEAT.win} + listens ×{HEAT.listen} (one listen per person). Days and weeks are in UTC; winners are announced when each ends.
        </Text>
        <Segmented
          value={race}
          onChange={setRace}
          options={[
            { value: "songsToday", label: "Song · day" },
            { value: "songsWeek", label: "Song · week" },
            { value: "albumsWeek", label: "Album · week" },
          ]}
        />
        {res.error ? <ErrorBanner message={res.error.message} onRetry={() => void res.reload()} /> : null}
        {res.loading && !t ? <Loading /> : null}
        {t && !list.length ? <EmptyState title="No votes yet" body="Fire up drops and pick in This or That to start the race." /> : null}
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
                  <Text style={type.small}>
                    {h.stats.score} heat · {statLine(h.stats)}
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
        <Text style={type.small}>{statLine(r.stats)}</Text>
        {r.release.kind !== "MIXTAPE" ? (
          <Text style={[type.small, { color: color.violetSoft }]} onPress={() => void listenOn("spotify", "release", r.release.id)} accessibilityRole="link">
            Spotify ↗
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[type.display, { fontSize: 22, color: color.violetSoft }]}>{r.stats.score}</Text>
        <Text style={type.small}>heat</Text>
      </View>
    </View>
  );
}
