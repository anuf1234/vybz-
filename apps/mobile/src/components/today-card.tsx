import type { TodayView } from "@vybz/core";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "./theme";
import { Cover } from "./war-card";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** "Today on VYBZ": the VYBZ streak, today's drops and today's trivia. */
export function TodayCard() {
  const router = useRouter();
  const today = useResource(() => api.today(), []);
  useFocusEffect(
    useCallback(() => {
      void today.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  const t: TodayView | null = today.data ?? null;
  if (!t) return null;
  const s = t.streak;
  const streakText = s.current === 0 ? "Start a streak: vote, battle, play trivia or 🔥 a drop." : s.activeToday ? `${s.current}-day streak. You're in for today.` : `${s.current}-day streak. Do one thing today to keep it.`;

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Text style={{ fontSize: 34, opacity: s.current && s.activeToday ? 1 : 0.5 }} accessibilityElementsHidden>
          🔥
        </Text>
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: color.text }]}>TODAY ON VYBZ</Text>
          <Text style={type.small}>
            {streakText}
            {s.freezes ? ` 🧊 ${s.freezes} freeze${s.freezes === 1 ? "" : "s"}.` : ""}
          </Text>
        </View>
      </View>

      <Pressable onPress={() => router.push("/drops")} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`Daily Drops: ${t.drops.today} new today`}>
        <View style={{ flexDirection: "row" }}>
          {t.drops.top.map((d, i) => (
            <View key={d.id} style={{ marginLeft: i ? -16 : 0 }}>
              <Cover url={d.artworkUrl} size={44} />
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { fontWeight: "800" }]}>🆕 Daily Drops</Text>
          <Text style={type.small}>{t.drops.today ? `${t.drops.today} new today · ${t.drops.week} this week` : t.drops.week ? `${t.drops.week} new this week` : "New music lands every day"}</Text>
        </View>
        <Text style={[type.body, { color: color.muted }]}>›</Text>
      </Pressable>

      <Pressable onPress={() => router.push("/trivia")} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={t.trivia.done ? "Today's trivia: done" : "Play today's trivia"}>
        <Text style={{ fontSize: 26 }}>🧠</Text>
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { fontWeight: "800" }]}>Today's trivia</Text>
          <Text style={type.small}>{t.trivia.done ? "Done ✓ Come back tomorrow." : "10 questions. Ready when you are."}</Text>
        </View>
        <Text style={[type.body, { color: color.muted }]}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.violet, backgroundColor: color.surface1 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, borderRadius: radius.md, backgroundColor: color.surface2 },
});
