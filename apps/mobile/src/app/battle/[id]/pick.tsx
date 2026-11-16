import type { CatalogHit } from "@vybz/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Artwork, EmptyState, ErrorBanner, Pill } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { TIER_LABEL } from "@/lib/format";

/** Catalog search for a round pick. Each hit shows how a guest would hear it. */
export default function Pick() {
  const { id, round } = useLocalSearchParams<{ id: string; round: string }>();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Debounced search.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.search(term);
        if (mine === seq.current) {
          setItems(res.items);
          setError(null);
        }
      } catch (err) {
        if (mine === seq.current) setError(err instanceof ApiRequestError ? err.message : "Search failed.");
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  async function pick(hit: CatalogHit) {
    setSubmitting(hit.catalogId);
    setError(null);
    try {
      await api.submit(id, Number(round), hit.catalogId);
      router.back();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't submit that pick.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
      <TextInput
        autoFocus
        placeholder="Search songs or artists"
        placeholderTextColor={color.lose}
        value={q}
        onChangeText={setQ}
        style={styles.search}
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel="Search songs"
      />
      {error ? <ErrorBanner message={error} /> : null}
      <FlatList
        data={items}
        keyExtractor={(h) => h.catalogId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space.sm, paddingBottom: space.xxl }}
        ListEmptyComponent={
          searching ? (
            <ActivityIndicator color={color.violet} style={{ marginTop: space.xl }} />
          ) : q.trim().length >= 2 ? (
            <EmptyState title="No matches" body="Try the artist name or a different spelling." />
          ) : (
            <EmptyState title="Find your pick" body="Your opponent won't see it until voting opens." />
          )
        }
        renderItem={({ item }) => {
          const best = item.sources[0];
          const playable = item.sources.some((s) => s.tier !== "LINK_OUT");
          return (
            <Pressable
              onPress={() => void pick(item)}
              disabled={!!submitting || !playable}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }, !playable && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel={`Pick ${item.title} by ${item.artistName}`}
            >
              <Artwork uri={item.artworkUrl} size={52} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {item.artistName}
                  {item.releaseYear ? ` · ${item.releaseYear}` : ""}
                </Text>
              </View>
              {submitting === item.catalogId ? <ActivityIndicator color={color.violet} /> : best ? <Pill text={TIER_LABEL[best.tier]} /> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, color: color.text, paddingHorizontal: space.md, fontSize: 17 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.surface1, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, padding: space.sm },
});
