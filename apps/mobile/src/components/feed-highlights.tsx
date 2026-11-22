import type { FeedHighlight } from "@vybz/core";
import { Image } from "expo-image";
import { type Href, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "./theme";

/**
 * "Happening on VYBZ": results, live battles, trending votes and featured
 * picks. Every card says where it came from: players (Community) or VYBZ
 * itself (From VYBZ), so curated content never passes as user activity.
 * `layout="list"` when the feed is otherwise empty, a swipeable row otherwise.
 */
export function FeedHighlights({ items, layout }: { items: FeedHighlight[]; layout: "list" | "row" }) {
  if (!items.length) return null;
  const header = (
    <View style={{ gap: 2 }}>
      <Text style={type.label}>HAPPENING ON VYBZ</Text>
      {layout === "list" ? <Text style={type.small}>Results, live battles and votes from around VYBZ. Follow people to see their posts here too.</Text> : null}
    </View>
  );
  if (layout === "row") {
    return (
      <View style={{ gap: space.sm }}>
        {header}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {items.map((h) => (
            <HighlightCard key={h.id} h={h} compact />
          ))}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      {header}
      {items.map((h) => (
        <HighlightCard key={h.id} h={h} />
      ))}
    </View>
  );
}

function SourceTag({ source }: { source: FeedHighlight["source"] }) {
  const editorial = source === "EDITORIAL";
  return (
    <View style={[styles.tag, editorial ? styles.tagEditorial : styles.tagCommunity]}>
      <Text style={[styles.tagText, { color: editorial ? color.violetSoft : color.live }]}>{editorial ? "FROM VYBZ" : "COMMUNITY"}</Text>
    </View>
  );
}

function HighlightCard({ h, compact }: { h: FeedHighlight; compact?: boolean }) {
  const router = useRouter();
  const art = h.artwork.slice(0, 2);
  return (
    <Pressable
      onPress={() => router.push(h.href as Href)}
      accessibilityRole="button"
      accessibilityLabel={`${h.source === "EDITORIAL" ? "From VYBZ" : "Community"}, ${h.label}: ${h.title}. ${h.subtitle}`}
      style={({ pressed }) => [styles.card, compact && styles.compact, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.top}>
        <SourceTag source={h.source} />
        <Text style={[type.small, { fontWeight: "700", color: h.kind === "LIVE" ? color.live : color.muted }]} numberOfLines={1}>
          {h.label}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
        {art.length ? (
          <View style={{ flexDirection: "row" }}>
            {art.map((u, i) => (
              <Image key={u} source={{ uri: u }} style={[styles.art, i > 0 && { marginLeft: -18, borderWidth: 2, borderColor: color.surface1 }]} contentFit="cover" />
            ))}
          </View>
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.body, { fontWeight: "800" }]} numberOfLines={2}>
            {h.title}
          </Text>
          <Text style={type.small} numberOfLines={compact ? 1 : 2}>
            {h.subtitle}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  compact: { width: 280 },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1 },
  tagCommunity: { borderColor: "#39FF8866", backgroundColor: "#39FF8814" },
  tagEditorial: { borderColor: "#C4B5FD66", backgroundColor: "#8B5CF61F" },
  tagText: { fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  art: { width: 52, height: 52, borderRadius: 10, backgroundColor: color.surface2 },
});
