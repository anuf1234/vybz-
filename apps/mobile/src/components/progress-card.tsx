import type { Streak } from "@vybz/core";
import { StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { color, space, type } from "./theme";
import { Card } from "./ui";

/** Level, XP toward the next level, and streaks on a profile. */
export function ProgressCard({ handle }: { handle: string }) {
  const p = useResource(() => api.progress(handle), [handle]);
  if (!p.data) return null;
  const { streaks, level, xp, levelXp, nextLevelXp } = p.data;
  const pct = nextLevelXp === null ? 1 : (xp - levelXp) / (nextLevelXp - levelXp);
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <LevelBadge level={level} />
        <View style={{ flex: 1, gap: 6 }} accessible accessibilityLabel={`Level ${level}, ${xp} XP${nextLevelXp !== null ? `, ${nextLevelXp - xp} to the next level` : ""}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[type.body, { fontWeight: "800" }]}>Level {level}</Text>
            <Text style={type.small}>{nextLevelXp === null ? `${xp} XP · max level` : `${xp - levelXp}/${nextLevelXp - levelXp} XP`}</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
          </View>
        </View>
      </View>
      <View style={styles.row}>
        <StreakStat icon="🔥" label="Daily" s={streaks.daily} />
        <StreakStat icon="⚡" label="Win streak" s={streaks.wins} />
        <StreakStat icon="🎚️" label="Days battling" s={streaks.play} />
      </View>
    </Card>
  );
}

export function LevelBadge({ level, size = 44 }: { level: number; size?: number }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: color.text, fontWeight: "900", fontSize: size * 0.4 }}>{level}</Text>
    </View>
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

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm },
  badge: { alignItems: "center", justifyContent: "center", backgroundColor: color.plum, borderWidth: 2, borderColor: color.violet },
  track: { height: 8, borderRadius: 4, backgroundColor: color.line, overflow: "hidden" },
  fill: { height: 8, backgroundColor: color.violet },
});
