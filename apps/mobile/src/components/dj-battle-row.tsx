import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { color, radius, space, type } from "./theme";

export function BattleRow({ id, title, a, b, note }: { id: string; title: string; a: string; b: string | null; note: string }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push({ pathname: "/dj/battle/[id]", params: { id } })} style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`${title}, @${a} versus ${b ? `@${b}` : "open"}`}>
      <Text style={type.heading} numberOfLines={1}>
        {title}
      </Text>
      <Text style={type.body}>
        @{a} <Text style={{ color: color.muted }}>vs</Text> {b ? `@${b}` : "???"}
      </Text>
      <Text style={type.small}>{note}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { padding: space.md, gap: 2, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
});
