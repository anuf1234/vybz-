import type { CatalogHit } from "@vybz/core";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TIER_LABEL } from "@/lib/format";
import { PreviewButton } from "./preview-player";
import { color, radius, space, type } from "./theme";
import { Artwork } from "./ui";

/**
 * One song in a list: cover, title, artist and year, how it plays, a preview
 * button, and whatever actions the screen adds on the right.
 */
export function SongRow({
  hit,
  rank,
  subtitle,
  note,
  noteTone = "muted",
  playing,
  onPreview,
  onPress,
  selected = false,
  disabled = false,
  right,
  accessibilityLabel,
}: {
  hit: CatalogHit;
  rank?: number;
  subtitle?: string;
  note?: string | null;
  noteTone?: "muted" | "danger";
  playing: boolean;
  onPreview: () => void;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  right?: ReactNode;
  accessibilityLabel?: string;
}) {
  const best = hit.sources[0];
  const label = accessibilityLabel ?? `${rank !== undefined ? `Number ${rank}, ` : ""}${hit.title} by ${hit.artistName}`;
  const content = (
    <>
      {rank !== undefined ? <Text style={styles.rank}>{rank}</Text> : null}
      <Artwork uri={hit.artworkUrl} size={52} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
          {hit.title}
          {hit.explicit ? " 🅴" : ""}
        </Text>
        <Text style={type.small} numberOfLines={1}>
          {subtitle ?? hit.artistName}
          {hit.releaseYear ? ` · ${hit.releaseYear}` : ""}
        </Text>
        {note ? (
          <Text style={[type.small, noteTone === "danger" ? { color: color.danger } : { fontSize: 11 }]} numberOfLines={1}>
            {note}
          </Text>
        ) : best ? (
          <Text style={[type.small, { fontSize: 11, letterSpacing: 0.5 }]}>{TIER_LABEL[best.tier].toUpperCase()}</Text>
        ) : null}
      </View>
      <PreviewButton hit={hit} playing={playing} onPress={onPreview} />
      {right}
    </>
  );
  // Rows without their own tap action are plain containers, so the buttons inside stay usable.
  if (!onPress) {
    return (
      <View style={[styles.row, selected && styles.selected]} accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && { opacity: 0.8 }, disabled && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.surface1, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, padding: space.sm },
  selected: { borderColor: color.violet, backgroundColor: color.plum },
  rank: { width: 22, textAlign: "center", color: color.muted, fontWeight: "800", fontSize: 15 },
});
