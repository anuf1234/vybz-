import type { WarListItem } from "@vybz/core";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "./theme";

export function Cover({ url, size = 64 }: { url: string | null; size?: number }) {
  return url ? <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: radius.sm }} accessibilityIgnoresInvertColors /> : <View style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: color.surface3 }} />;
}

export function WarCard({ w }: { w: WarListItem }) {
  const router = useRouter();
  const side = (s: "A" | "B") => {
    const x = s === "A" ? w.a : w.b;
    const won = w.winner === s;
    return (
      <View style={{ flex: 1, alignItems: "center", gap: 4, opacity: w.winner && !won && w.winner !== "DRAW" ? 0.55 : 1 }}>
        <Cover url={x.artworkUrl} size={96} />
        <Text style={[type.body, { fontWeight: "800", textAlign: "center" }]} numberOfLines={2}>
          {won ? "🏆 " : ""}
          {x.title}
        </Text>
        <Text style={[type.small, { textAlign: "center" }]} numberOfLines={1}>
          {x.artistName}
          {x.releaseYear ? ` · ${x.releaseYear}` : ""}
        </Text>
      </View>
    );
  };
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/wars/[id]", params: { id: w.id } })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={`${w.kind === "ALBUM" ? "Album" : "Single"} war: ${w.title}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {side("A")}
        <Text style={[type.display, { fontSize: 22, color: color.muted }]}>VS</Text>
        {side("B")}
      </View>
      <Text style={[type.small, { textAlign: "center" }]}>
        {w.kind === "ALBUM" ? "💿 Album war" : "🎵 Single war"} · {w.voters} voter{w.voters === 1 ? "" : "s"}
        {w.status === "OPEN" ? (w.voted ? " · you voted" : " · vote now") : w.winner === "DRAW" ? " · draw" : ""}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
});
