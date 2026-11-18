import { GENRES, type TriviaLeaderRow, frameColor } from "@vybz/core";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "./theme";
import { Avatar } from "./ui";

/** A horizontal row of choices, one selected (or none, for "Any"). */
export function Chips<T extends string>({ value, options, onChange, anyLabel }: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T | null) => void; anyLabel?: string }) {
  const all: { value: T | null; label: string }[] = anyLabel ? [{ value: null, label: anyLabel }, ...options] : options;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
      {all.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value ?? "any"}
            onPress={() => onChange(o.value)}
            style={[styles.chip, on && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[type.small, on && { color: color.text, fontWeight: "700" }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export const GENRE_OPTIONS = GENRES.map((g) => ({ value: g.key, label: g.label }));

export function TriviaLeader({ row }: { row: TriviaLeaderRow }) {
  return (
    <View style={[styles.row, row.isYou && { backgroundColor: color.surface2 }]} accessibilityLabel={`Rank ${row.rank}, ${row.user.displayName}, ${row.score} points`}>
      <Text style={[type.heading, { width: 34, textAlign: "center", color: row.rank <= 3 ? color.violetSoft : color.muted }]}>{row.rank}</Text>
      <Avatar name={row.user.displayName} image={row.user.image} size={32} ring={frameColor(row.user.frame)} />
      <View style={{ flex: 1 }}>
        <Text style={type.body} numberOfLines={1}>
          {row.user.displayName}
          {row.isYou ? " (you)" : ""}
        </Text>
        <Text style={type.small}>
          @{row.user.handle}
          {row.games > 1 ? ` · ${row.games} games` : ""}
        </Text>
      </View>
      <Text style={[type.heading, { fontVariant: ["tabular-nums"] }]}>{row.score}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  chipOn: { borderColor: color.violet, backgroundColor: color.plum },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.sm, borderRadius: radius.md },
});
