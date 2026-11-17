import { Ionicons } from "@expo/vector-icons";
import { type PlaylistSummary, themeLabel } from "@vybz/core";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "./theme";

/** A 2×2 mosaic of the first covers, or a placeholder. */
export function Mosaic({ urls, size }: { urls: string[]; size: number }) {
  if (urls.length < 4) {
    return urls[0] ? (
      <Image source={{ uri: urls[0] }} style={[styles.tile, { width: size, height: size }]} contentFit="cover" />
    ) : (
      <View style={[styles.tile, styles.empty, { width: size, height: size }]}>
        <Ionicons name="musical-notes" size={size * 0.4} color={color.muted} />
      </View>
    );
  }
  const half = size / 2;
  return (
    <View style={[styles.tile, { width: size, height: size, flexDirection: "row", flexWrap: "wrap" }]}>
      {urls.slice(0, 4).map((u) => (
        <Image key={u} source={{ uri: u }} style={{ width: half, height: half }} contentFit="cover" />
      ))}
    </View>
  );
}

export function PlaylistCard({ p, onPress, showOwner = false }: { p: PlaylistSummary; onPress: () => void; showOwner?: boolean }) {
  const theme = themeLabel({ genres: p.genres, eraFrom: p.eraFrom ?? undefined, eraTo: p.eraTo ?? undefined });
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`${p.title}, ${p.trackCount} songs`}>
      <Mosaic urls={p.artworkUrls} size={64} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
          {p.title}
        </Text>
        <Text style={type.small} numberOfLines={1}>
          {p.trackCount} {p.trackCount === 1 ? "song" : "songs"}
          {theme ? ` · ${theme}` : ""}
          {showOwner ? ` · @${p.owner.handle}` : ""}
        </Text>
      </View>
      {p.visibility === "PRIVATE" ? <Ionicons name="lock-closed" size={16} color={color.muted} accessibilityLabel="Private" /> : null}
      <Ionicons name="chevron-forward" size={18} color={color.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.surface1, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, padding: space.sm },
  tile: { borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.surface3 },
  empty: { alignItems: "center", justifyContent: "center" },
});
