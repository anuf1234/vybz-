import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { color, radius, space, type } from "./theme";

/** A profile's unlocked badges at a glance; opens the full list. */
export function AchievementStrip({ handle }: { handle: string }) {
  const router = useRouter();
  const list = useResource(() => api.achievements(handle), [handle]);
  if (!list.data) return null;
  const unlocked = list.data.items.filter((i) => i.unlockedAt);
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/achievements", params: { handle } })}
      style={styles.strip}
      accessibilityRole="button"
      accessibilityLabel={`Achievements, ${list.data.unlocked} of ${list.data.total} unlocked`}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.label}>Achievements</Text>
        <Text style={[type.body, { fontSize: 22, letterSpacing: 2 }]} numberOfLines={1}>
          {unlocked.length ? unlocked.slice(0, 8).map((i) => i.icon).join("") : "None yet"}
        </Text>
      </View>
      <Text style={[type.body, { fontWeight: "800" }]}>
        {list.data.unlocked}/{list.data.total} ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.line },
});
