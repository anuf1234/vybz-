import type { Streak } from "@vybz/core";
import { StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { color, space, type } from "./theme";
import { Card } from "./ui";

/** Streaks on a profile. */
export function ProgressCard({ handle }: { handle: string }) {
  const p = useResource(() => api.progress(handle), [handle]);
  if (!p.data) return null;
  const { streaks } = p.data;
  return (
    <Card style={styles.row}>
      <StreakStat icon="🔥" label="Daily" s={streaks.daily} />
      <StreakStat icon="⚡" label="Win streak" s={streaks.wins} />
      <StreakStat icon="🎚️" label="Days battling" s={streaks.play} />
    </Card>
  );
}

function StreakStat({ icon, label, s }: { icon: string; label: string; s: Streak }) {
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }} accessible accessibilityLabel={`${label}: ${s.current}, best ${s.best}`}>
      <Text style={[type.heading, { fontWeight: "800", color: s.current ? color.text : color.muted }]}>
        {icon} {s.current}
      </Text>
      <Text style={type.label}>{label}</Text>
      <Text style={[type.small, { fontSize: 11 }]}>Best {s.best}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", gap: space.sm } });
