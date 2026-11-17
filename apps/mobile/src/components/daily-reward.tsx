import type { DailyRewardState } from "@vybz/core";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { color, radius, space, type } from "./theme";
import { Button, Card } from "./ui";

/** Home's daily reward: a 7-day ladder and a claim button. */
export function DailyReward({ onClaimed }: { onClaimed?: () => void }) {
  const router = useRouter();
  const state = useResource(() => api.daily(), []);
  const [claimed, setClaimed] = useState<DailyRewardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = claimed ?? state.data;
  if (!s) return null;

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.claimDaily();
      setClaimed(res.state);
      onClaimed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      void state.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={type.heading}>Daily reward</Text>
        <Pressable onPress={() => router.push("/wallet")} accessibilityRole="link" accessibilityLabel={`${s.balance.coins} coins. Open XP and coins`}>
          <Text style={type.small}>
            {s.streak ? `🔥 ${s.streak}-day streak` : "Start a streak"} · 🪙 {s.balance.coins} ›
          </Text>
        </Pressable>
      </View>
      <View style={styles.ladder}>
        {s.ladder.map((r, i) => {
          const day = i + 1;
          const done = day < s.ladderDay || (day === s.ladderDay && s.claimedToday);
          const current = day === s.ladderDay;
          return (
            <View key={day} style={[styles.step, done && styles.done, current && styles.current]} accessible accessibilityLabel={`Day ${day}: ${r.xp} XP and ${r.coins} coins${done ? ", claimed" : ""}`}>
              <Text style={[type.small, { fontSize: 10 }]}>Day {day}</Text>
              <Text style={{ fontSize: day === 7 ? 18 : 14 }}>{done ? "✓" : day === 7 ? "🎁" : "🪙"}</Text>
              <Text style={[type.small, { fontSize: 10, fontWeight: "700", color: color.text }]}>{r.coins}</Text>
            </View>
          );
        })}
      </View>
      {s.canClaim ? (
        <Button title={`Claim +${s.reward.xp} XP · +${s.reward.coins} coins`} loading={busy} onPress={() => void claim()} />
      ) : (
        <Text style={[type.small, { textAlign: "center" }]}>{s.claimedToday ? `Claimed +${s.reward.xp} XP · +${s.reward.coins} coins. Come back tomorrow.` : "Come back a little later."}</Text>
      )}
      {error ? <Text style={[type.small, { color: color.danger, textAlign: "center" }]}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  ladder: { flexDirection: "row", gap: 6 },
  step: { flex: 1, alignItems: "center", gap: 2, paddingVertical: space.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  done: { opacity: 0.55 },
  current: { borderColor: color.violet, backgroundColor: color.plum, opacity: 1 },
});
