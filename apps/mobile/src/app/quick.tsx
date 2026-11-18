import { DECADES, GENRES, decadeLabel } from "@vybz/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useServerConfig } from "@/lib/config";

/** One tap to a duel: pick a vibe (or don't), get matched, or play the bot. */
export default function Quick() {
  const router = useRouter();
  const session = useSession();
  const config = useServerConfig();
  const botAvailable = Boolean(config?.aiJudge.available);
  const params = useLocalSearchParams<{ genre?: string }>();
  const [genre, setGenre] = useState<string | null>(params.genre && GENRES.some((g) => g.key === params.genre) ? params.genre : null);
  const [decade, setDecade] = useState<number | null>(null);
  const [busy, setBusy] = useState<"find" | "bot" | null>(null);
  const [waitingId, setWaitingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // While waiting, watch for someone (or the bot) to take it.
  useEffect(() => {
    if (!waitingId) return;
    const t = setInterval(() => {
      void api
        .battle(waitingId)
        .then((b) => {
          if (b.status === "IN_PROGRESS") router.replace({ pathname: "/battle/[id]", params: { id: waitingId } });
          else if (b.status !== "OPEN_CHALLENGE") setWaitingId(null);
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [waitingId, router]);

  if (!session.data) return <EmptyState title="Sign in to battle" body="Quick battles match you with someone in seconds." />;

  const go = async (vsBot: boolean) => {
    setBusy(vsBot ? "bot" : "find");
    setError(null);
    try {
      const r = await api.quickBattle({ genre, decade, vsBot });
      if (r.matched === "waiting") setWaitingId(r.id);
      else router.replace({ pathname: "/battle/[id]", params: { id: r.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!waitingId) return;
    await api.cancel(waitingId).catch(() => undefined);
    setWaitingId(null);
  };

  if (waitingId) {
    return (
      <View style={{ flex: 1, padding: space.lg, gap: space.lg, justifyContent: "center" }}>
        <ActivityIndicator color={color.violet} size="large" />
        <Text style={[type.title, { textAlign: "center" }]}>Finding an opponent…</Text>
        <Text style={[type.small, { textAlign: "center" }]}>
          Your battle is open to everyone looking for the same vibe.{botAvailable ? " If nobody takes it in a couple of minutes, the VYBZ bot will." : ""}
        </Text>
        {botAvailable ? <Button title="🤖 Play the VYBZ bot now" loading={busy === "bot"} onPress={() => void go(true)} /> : null}
        <Button title="Open my battle" kind="secondary" onPress={() => router.replace({ pathname: "/battle/[id]", params: { id: waitingId } })} />
        <Button title="Cancel" kind="ghost" onPress={() => void cancel()} />
        {error ? <Text style={[type.small, { color: color.danger, textAlign: "center" }]}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      <Text style={type.small}>
        3 rounds, one song each, 30 minutes to pick.{botAvailable ? " The AI judge calls every round, so there's no waiting for votes." : ""}
      </Text>
      <Card style={{ gap: space.sm }}>
        <Text style={type.label}>Genre</Text>
        <View style={styles.wrap}>
          <Chip label="Any" active={genre === null} onPress={() => setGenre(null)} />
          {GENRES.map((g) => (
            <Chip key={g.key} label={g.label} active={genre === g.key} onPress={() => setGenre(g.key)} />
          ))}
        </View>
        <Text style={[type.label, { marginTop: space.sm }]}>Era</Text>
        <View style={styles.wrap}>
          <Chip label="Any" active={decade === null} onPress={() => setDecade(null)} />
          {DECADES.map((d) => (
            <Chip key={d} label={decadeLabel(d)} active={decade === d} onPress={() => setDecade(d)} />
          ))}
        </View>
      </Card>
      <Button title="⚡ Find a battle" loading={busy === "find"} onPress={() => void go(false)} />
      {botAvailable ? <Button title="🤖 Play the VYBZ bot" kind="secondary" loading={busy === "bot"} onPress={() => void go(true)} /> : null}
      {error ? <Text style={[type.small, { color: color.danger, textAlign: "center" }]}>{error}</Text> : null}
    </ScrollView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
      <Text style={{ color: active ? color.text : color.muted, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  chipActive: { borderColor: color.violet, backgroundColor: color.plum },
});
