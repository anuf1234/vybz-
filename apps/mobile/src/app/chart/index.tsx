import type { ChartRow } from "@vybz/core";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { API_URL, useServerConfig } from "@/lib/config";
import { ApiRequestError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { listenOn } from "@/lib/listen";
import { shareMenu } from "@/lib/share-card";
import { useResource } from "@/lib/use-resource";

/** The VYBZ Chart: new releases ranked by fans' This or That picks, week by week. */
export default function Chart() {
  const router = useRouter();
  const session = useSession();
  const [week, setWeek] = useState<string | null>(null);
  const res = useResource(() => api.chart(week), [week]);
  const c = res.data;
  const config = useServerConfig();

  return (
    <>
      <Stack.Screen options={{ title: "The VYBZ Chart" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={res.refreshing} onRefresh={() => void res.reload()} />}>
        <View style={{ gap: space.xs }}>
          <Text style={[type.display, { fontSize: 30 }]}>THE VYBZ CHART</Text>
          <Text style={type.small}>New releases ranked by fans in This or That. A release needs {5} matchups to chart.</Text>
        </View>
        {c ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Pressable onPress={() => c.prevWeek && setWeek(c.prevWeek)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous week">
              <Text style={[type.body, { color: c.prevWeek ? color.text : color.muted }]}>‹ Prev</Text>
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[type.body, { fontWeight: "800" }]}>{c.label}</Text>
              <Text style={type.small}>{c.final ? "Final" : "Live this week"}</Text>
            </View>
            <Pressable onPress={() => c.nextWeek && setWeek(c.nextWeek)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Next week">
              <Text style={[type.body, { color: c.nextWeek ? color.text : color.muted }]}>Next ›</Text>
            </Pressable>
          </View>
        ) : null}
        {session.data ? <Button title="🆚 Vote in This or That" onPress={() => router.push("/verdict")} /> : null}
        {c?.rows.length ? (
          <Button
            title="Share this chart"
            kind="secondary"
            onPress={() => shareMenu({ kind: "chart", id: c.week, title: "Share the VYBZ Chart", message: `The VYBZ Chart (${c.label}): #1 is ${c.rows[0]!.release.title} by ${c.rows[0]!.release.artistName}.`, url: `${API_URL}/chart/${c.week}` })}
          />
        ) : null}
        {c?.rows.length && session.data && config?.spotify ? <SpotifySave week={c.week} /> : null}
        {res.error ? <ErrorBanner message={res.error.message} onRetry={() => void res.reload()} /> : null}
        {res.loading && !c ? <Loading /> : null}
        {c && !c.rows.length ? <EmptyState title="Nothing charting yet" body="Releases chart once fans have matched them up a few times. Go vote!" /> : null}
        {c?.rows.map((r) => <Row key={r.release.id} r={r} />)}
      </ScrollView>
    </>
  );
}

/** Save the week's chart as a private playlist on your Spotify (connects Spotify the first time). */
function SpotifySave({ week }: { week: string }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.chartToSpotify(week);
      Alert.alert("Saved to Spotify", `${r.added} songs added to a private playlist.`, [
        { text: "Open Spotify", onPress: () => void Linking.openURL(r.url) },
        { text: "OK", style: "cancel" },
      ]);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "SPOTIFY_NOT_LINKED") {
        const res = await authClient.linkSocial({ provider: "spotify", callbackURL: "/chart" });
        if (res.error) Alert.alert("Couldn't connect Spotify", "Try again in a moment.");
        else Alert.alert("Spotify connected", "Tap Save to Spotify again to make the playlist.");
      } else Alert.alert("Couldn't save", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };
  return <Button title={busy ? "Saving…" : "Save to Spotify"} kind="secondary" disabled={busy} onPress={() => void save()} />;
}

function Row({ r }: { r: ChartRow }) {
  const move = r.lastRank === null ? "NEW" : r.lastRank > r.rank ? `▲${r.lastRank - r.rank}` : r.lastRank < r.rank ? `▼${r.rank - r.lastRank}` : "=";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: r.rank === 1 ? color.violet : color.line, backgroundColor: color.surface1 }}>
      <Text style={[type.display, { fontSize: 24, width: 34, textAlign: "right" }]}>{r.rank}</Text>
      <Cover url={r.release.artworkUrl} size={52} />
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: "800" }]} numberOfLines={1}>
          {r.release.title}
        </Text>
        <Text style={type.small} numberOfLines={1}>
          {r.release.artistName} · {r.games} matchups
        </Text>
        {r.release.kind !== "MIXTAPE" ? (
          <Text style={[type.small, { color: color.violetSoft }]} onPress={() => void listenOn("spotify", "release", r.release.id)} accessibilityRole="link">
            Spotify ↗
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[type.body, { fontWeight: "800", color: color.violetSoft }]}>{r.score}%</Text>
        <Text style={type.small}>{move}</Text>
      </View>
    </View>
  );
}
