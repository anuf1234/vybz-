import { type CatalogHit, themeLabel } from "@vybz/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Artwork, Button, EmptyState, ErrorBanner, Pill, Segmented } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { TIER_LABEL } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import { useServerConfig } from "@/lib/config";
import type { ProviderKind } from "@vybz/providers";

/**
 * Catalog search for a round's picks: select the agreed number of tracks, in
 * play order, then lock them in. Each hit shows how a guest would hear it.
 */
export default function Pick() {
  const { id, round } = useLocalSearchParams<{ id: string; round: string }>();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [picked, setPicked] = useState<CatalogHit[]>([]);
  const battle = useResource(() => api.battle(id), [id]);
  const need = battle.data?.rules.tracksPerRound ?? 1;
  const theme = battle.data ? themeLabel(battle.data.rules.constraints) : null;
  const config = useServerConfig();
  const catalogs = config?.catalogs ?? [];
  const [source, setSource] = useState<ProviderKind | null>(null);
  const activeSource = source ?? catalogs[0]?.provider ?? null;
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
        const res = await api.search(term, activeSource ?? undefined);
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
  }, [q, activeSource]);

  function toggle(hit: CatalogHit) {
    setError(null);
    setPicked((cur) => {
      if (cur.some((p) => p.catalogId === hit.catalogId)) return cur.filter((p) => p.catalogId !== hit.catalogId);
      if (need === 1) return [hit];
      return cur.length >= need ? cur : [...cur, hit];
    });
  }

  async function lockIn() {
    setSubmitting(true);
    setError(null);
    try {
      await api.submit(id, Number(round), picked.map((p) => p.catalogId));
      router.back();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't submit those picks.");
    } finally {
      setSubmitting(false);
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
      {catalogs.length > 1 && activeSource ? (
        <Segmented
          value={activeSource}
          onChange={(v) => setSource(v)}
          options={catalogs.map((c) => ({ value: c.provider, label: c.label }))}
        />
      ) : null}
      {activeSource === "YOUTUBE" && catalogs.length > 1 ? (
        <Text style={type.small}>YouTube picks are matched to Apple Music when possible, so everyone can hear them either way.</Text>
      ) : null}
      {theme ? <Text style={type.small}>This battle is {theme}. Picks must fit.</Text> : null}
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
            <EmptyState title={need > 1 ? `Find your ${need} picks` : "Find your pick"} body={`Your opponent won't see ${need > 1 ? "them" : "it"} until voting opens.${need > 1 ? " They play in the order you pick them." : ""}`} />
          )
        }
        renderItem={({ item }) => {
          const best = item.sources[0];
          const playable = item.sources.some((s) => s.tier !== "LINK_OUT");
          const order = picked.findIndex((p) => p.catalogId === item.catalogId);
          return (
            <Pressable
              onPress={() => toggle(item)}
              disabled={submitting || !playable}
              style={({ pressed }) => [styles.row, order >= 0 && styles.rowPicked, pressed && { opacity: 0.8 }, !playable && { opacity: 0.5 }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: order >= 0, disabled: !playable }}
              accessibilityLabel={`${item.title} by ${item.artistName}`}
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
              {order >= 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{need > 1 ? order + 1 : "✓"}</Text>
                </View>
              ) : best ? (
                <Pill text={TIER_LABEL[best.tier]} />
              ) : null}
            </Pressable>
          );
        }}
      />
      <Button
        title={picked.length === need ? (need === 1 ? "Lock in pick" : `Lock in ${need} picks`) : `Pick ${need - picked.length} more`}
        disabled={picked.length !== need}
        loading={submitting}
        onPress={() => void lockIn()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, color: color.text, paddingHorizontal: space.md, fontSize: 17 },
  rowPicked: { borderColor: color.violet, backgroundColor: color.plum },
  badge: { width: 28, height: 28, borderRadius: 14, backgroundColor: color.violet, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.surface1, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, padding: space.sm },
});
