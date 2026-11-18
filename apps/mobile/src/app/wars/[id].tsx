import { Ionicons } from "@expo/vector-icons";
import type { WarTrack, WarView } from "@vybz/core";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { color, radius, sideColor, space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Loading } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

/** One war: vote each category, then track by track. Counts show once you've voted in a category. */
export default function War() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const res = useResource(() => api.war(id), [id]);
  const [w, setW] = useState<WarView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => {
    if (res.data) setW(res.data);
  }, [res.data]);
  useEffect(() => {
    if (status.didJustFinish || (status.playing && status.currentTime >= 30)) {
      player.pause();
      setPlaying(null);
    }
  }, [status.didJustFinish, status.currentTime, status.playing, player]);
  useEffect(() => () => player.pause(), [player]);

  if (res.error && !w) return <ErrorBanner message={res.error.message} onRetry={() => void res.reload()} />;
  if (!w) return <Loading />;
  const open = w.status === "OPEN";
  const canVote = open && !!session.data;

  const vote = async (category: string, side: "A" | "B") => {
    setBusy(`${category}:${side}`);
    setError(null);
    try {
      setW(await api.voteWar(w.id, category, side));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That vote didn't go through.");
    } finally {
      setBusy(null);
    }
  };

  const toggle = (t: WarTrack) => {
    if (!t.previewUrl) return;
    if (playing === t.previewUrl) {
      player.pause();
      setPlaying(null);
      return;
    }
    player.replace({ uri: t.previewUrl });
    player.play();
    setPlaying(t.previewUrl);
  };

  const Bar = ({ a, b, mine }: { a: number | null; b: number | null; mine: "A" | "B" | null }) => {
    if (a === null || b === null) return null;
    const total = a + b || 1;
    return (
      <View style={{ gap: 2 }}>
        <View style={styles.bar}>
          <View style={{ flex: a || 0.0001, backgroundColor: sideColor(0) }} />
          <View style={{ flex: b || 0.0001, backgroundColor: sideColor(1) }} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={[type.small, mine === "A" && { color: color.text, fontWeight: "800" }]}>{Math.round((100 * a) / total)}%</Text>
          <Text style={[type.small, mine === "B" && { color: color.text, fontWeight: "800" }]}>{Math.round((100 * b) / total)}%</Text>
        </View>
      </View>
    );
  };

  const Pick = ({ category, side, label, mine }: { category: string; side: "A" | "B"; label: string; mine: "A" | "B" | null }) => (
    <Pressable
      disabled={!canVote || busy !== null}
      onPress={() => void vote(category, side)}
      style={[styles.pick, { borderColor: mine === side ? sideColor(side === "A" ? 0 : 1) : color.line, backgroundColor: mine === side ? color.plum : color.surface2 }, !canVote && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: mine === side }}
      accessibilityLabel={`Vote ${label}`}
    >
      <Text style={[type.body, { fontWeight: "700", textAlign: "center" }]} numberOfLines={2}>
        {mine === side ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={res.refreshing} onRefresh={() => void res.reload()} />}>
      <Stack.Screen options={{ title: w.kind === "ALBUM" ? "Album war" : "Single war" }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {(["A", "B"] as const).map((s) => {
          const x = s === "A" ? w.a : w.b;
          return (
            <View key={s} style={{ flex: 1, alignItems: "center", gap: 4 }}>
              <Cover url={x.artworkUrl} size={140} />
              <Text style={[type.heading, { textAlign: "center" }]} numberOfLines={2}>
                {w.winner === s ? "🏆 " : ""}
                {x.title}
              </Text>
              <Text style={type.small}>
                {x.artistName}
                {x.releaseYear ? ` · ${x.releaseYear}` : ""}
              </Text>
              {x.externalUrl ? (
                <Pressable onPress={() => void Linking.openURL(x.externalUrl!)} hitSlop={6}>
                  <Text style={[type.small, { color: color.violetSoft }]}>Listen ↗</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      <Text style={[type.small, { textAlign: "center" }]}>
        {w.voters} voter{w.voters === 1 ? "" : "s"} · {open ? `voting closes ${new Date(w.closesAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : w.winner === "DRAW" ? "ended in a draw" : "final result"} · started by @{w.creator.handle}
      </Text>
      {!session.data && open ? <Text style={[type.small, { textAlign: "center" }]}>Sign in to vote.</Text> : null}
      {error ? <ErrorBanner message={error} /> : null}

      {w.categories.map((c) => (
        <Card key={c.key} style={{ gap: space.sm }}>
          <Text style={type.label}>{c.label}</Text>
          <Text style={type.small}>{c.hint}</Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Pick category={c.key} side="A" label={w.a.title} mine={c.mine} />
            <Pick category={c.key} side="B" label={w.b.title} mine={c.mine} />
          </View>
          <Bar a={c.a} b={c.b} mine={c.mine} />
        </Card>
      ))}

      {w.tracks.length ? (
        <View style={{ gap: space.sm }}>
          <Text style={type.label}>Track by track</Text>
          {w.tracks.map((t) => (
            <Card key={t.index} style={{ gap: space.sm }}>
              <Text style={type.small}>Track {t.index + 1}</Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                {(["A", "B"] as const).map((s) => {
                  const tr = s === "A" ? t.a : t.b;
                  return (
                    <View key={s} style={{ flex: 1, gap: 4 }}>
                      <Pressable
                        disabled={!canVote || busy !== null}
                        onPress={() => void vote(`t${t.index + 1}`, s)}
                        style={[styles.pick, { minHeight: 56, borderColor: t.mine === s ? sideColor(s === "A" ? 0 : 1) : color.line, backgroundColor: t.mine === s ? color.plum : color.surface2 }]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: t.mine === s }}
                        accessibilityLabel={`Vote ${tr.title}`}
                      >
                        <Text style={[type.body, { fontWeight: "700", textAlign: "center" }]} numberOfLines={2}>
                          {t.mine === s ? "✓ " : ""}
                          {tr.title}
                        </Text>
                      </Pressable>
                      {tr.previewUrl ? (
                        <Pressable onPress={() => toggle(tr)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }} accessibilityRole="button" accessibilityLabel={`${playing === tr.previewUrl ? "Stop" : "Play"} preview of ${tr.title}`}>
                          <Ionicons name={playing === tr.previewUrl ? "stop-circle" : "play-circle"} size={22} color={color.violetSoft} />
                          <Text style={type.small}>Preview</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              <Bar a={t.votes?.a ?? null} b={t.votes?.b ?? null} mine={t.mine} />
            </Card>
          ))}
        </View>
      ) : null}

      <Button title="Share this war" kind="secondary" onPress={() => void Share.share({ message: `${w.title}: which wins? Vote on VYBZ.` })} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pick: { flex: 1, minHeight: 48, padding: space.sm, borderRadius: radius.md, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  bar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: color.surface3 },
});
