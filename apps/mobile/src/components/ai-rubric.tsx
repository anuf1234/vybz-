import { AI_RUBRIC } from "@vybz/core";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "./theme";

/** "How the AI judges": the rubric, from the same list the judge is given. Collapsed until tapped. */
export function AiRubricNote({ tiebreakOnly }: { tiebreakOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.box}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={8}>
        <Text style={[type.small, { color: color.violetSoft, fontWeight: "800" }]}>
          {open ? "▾" : "▸"} How the AI judges{tiebreakOnly ? " (only if the vote ties)" : ""}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ gap: space.xs, marginTop: space.xs }}>
          <Text style={type.small}>It can't hear the songs. It judges what it knows about each recording, most important first:</Text>
          {AI_RUBRIC.map((r, i) => (
            <Text key={r.key} style={type.small}>
              <Text style={{ color: color.text, fontWeight: "700" }}>
                {i + 1}. {r.label}.
              </Text>{" "}
              {r.hint}
            </Text>
          ))}
          <Text style={type.small}>Picks show as A and B in random order, so it never knows who chose what. Songs that are too new for it to know aren't marked down for it.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
});
