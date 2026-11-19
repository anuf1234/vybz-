import type { ReleaseView, VerdictPair } from "@vybz/core";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { api } from "@/lib/api";
import { listenOn } from "@/lib/listen";

/** This or That: pick the better of two new drops. Picks build each release's Fan Verdict and the weekly VYBZ Chart. */
export default function Verdict() {
  const router = useRouter();
  const [pair, setPair] = useState<VerdictPair | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    api
      .verdictPair()
      .then((r) => setPair(r.pair))
      .catch((e: Error) => setError(e.message));
  }, []);

  const pick = async (winner: ReleaseView) => {
    if (!pair || busy) return;
    setBusy(true);
    try {
      const r = await api.judge(pair.a.id, pair.b.id, winner.id);
      setDone((n) => n + 1);
      setPair(r.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that pick.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "This or That" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
        <View style={{ gap: space.xs }}>
          <Text style={[type.display, { fontSize: 30 }]}>THIS OR THAT</Text>
          <Text style={type.small}>Two new drops. Tap the one you'd rather play. Your picks rank the weekly VYBZ Chart.</Text>
        </View>
        {error ? <ErrorBanner message={error} /> : null}
        {pair === undefined && !error ? <Loading /> : null}
        {pair === null ? (
          <EmptyState
            title={done ? "You've judged every matchup" : "No matchups right now"}
            body="New drops land every day. Check the chart to see where things stand."
            action={<Button title="📊 See the VYBZ Chart" onPress={() => router.replace("/chart")} />}
          />
        ) : null}
        {pair ? (
          <>
            <View style={{ flexDirection: "row", gap: space.md }}>
              <Side r={pair.a} onPick={() => void pick(pair.a)} disabled={busy} />
              <Side r={pair.b} onPick={() => void pick(pair.b)} disabled={busy} />
            </View>
            <Text style={[type.small, { textAlign: "center" }]}>
              {done ? `${done} pick${done === 1 ? "" : "s"} this session · ` : ""}
              {pair.judgedToday + done} today
            </Text>
            <Button title="Skip this one" kind="secondary" disabled={busy} onPress={() => void api.verdictPair().then((r) => setPair(r.pair))} />
          </>
        ) : null}
        <Button title="📊 The VYBZ Chart" kind="secondary" onPress={() => router.push("/chart")} />
      </ScrollView>
    </>
  );
}

function Side({ r, onPick, disabled }: { r: ReleaseView; onPick: () => void; disabled: boolean }) {
  return (
    <View style={{ flex: 1, gap: space.sm }}>
      <Pressable onPress={onPick} disabled={disabled} style={({ pressed }) => [styles.side, pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] }]} accessibilityRole="button" accessibilityLabel={`Pick ${r.title} by ${r.artistName}`}>
        <Cover url={r.artworkUrl} size={150} />
        <Text style={[type.body, { fontWeight: "800", textAlign: "center" }]} numberOfLines={2}>
          {r.title}
        </Text>
        <Text style={[type.small, { textAlign: "center" }]} numberOfLines={1}>
          {r.artistName}
        </Text>
      </Pressable>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: space.md }}>
        {r.externalUrl ? (
          <Text style={[type.small, { color: color.violetSoft }]} onPress={() => void listenOn("source", "release", r.id)} accessibilityRole="link">
            Listen ↗
          </Text>
        ) : null}
        {r.kind !== "MIXTAPE" ? (
          <Text style={[type.small, { color: color.violetSoft }]} onPress={() => void listenOn("spotify", "release", r.id)} accessibilityRole="link">
            Spotify ↗
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  side: { alignItems: "center", gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
});
