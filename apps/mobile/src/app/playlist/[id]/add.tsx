import { Ionicons } from "@expo/vector-icons";
import type { CatalogHit } from "@vybz/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from "react-native";
import { usePreviewPlayer } from "@/components/preview-player";
import { SongRow } from "@/components/song-row";
import { color, radius, space } from "@/components/theme";
import { EmptyState, ErrorBanner, Segmented } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

type Source = "search" | "saved" | "suggested";

/** Add songs to a playlist from search, your saved songs, or suggestions for its theme. Tap to add. */
export default function AddToPlaylist() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pl = useResource(() => api.playlist(id), [id]);
  const themed = Boolean(pl.data && (pl.data.genres.length || pl.data.eraFrom !== null));
  const [source, setSource] = useState<Source>("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const preview = usePreviewPlayer();
  const saved = useResource(source === "saved" ? () => api.library() : null, [source]);
  const suggested = useResource(
    source === "suggested" && pl.data ? () => api.suggestions({ genres: pl.data!.genres, eraFrom: pl.data!.eraFrom ?? undefined, eraTo: pl.data!.eraTo ?? undefined }) : null,
    [source, Boolean(pl.data)],
  );

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setResults([]);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.search(term);
        if (mine === seq.current) setResults(res.items);
      } catch (err) {
        if (mine === seq.current) setError(err instanceof ApiRequestError ? err.message : "Search failed.");
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => preview.stop, [preview.stop]);

  const inPlaylist = new Set(pl.data?.tracks.map((t) => t.catalogId) ?? []);
  const list = source === "search" ? results : source === "saved" ? (saved.data?.items ?? []) : (suggested.data?.items ?? []);
  const loading = source === "search" ? searching : source === "saved" ? saved.loading && !saved.data : suggested.loading && !suggested.data;

  async function add(hit: CatalogHit) {
    setBusy(hit.catalogId);
    setError(null);
    try {
      await api.addToPlaylist(id, "trackId" in hit && typeof hit.trackId === "string" ? { trackId: hit.trackId } : { catalogId: hit.catalogId });
      setAdded((s) => new Set(s).add(hit.catalogId));
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "ALREADY_IN_PLAYLIST") setAdded((s) => new Set(s).add(hit.catalogId));
      else setError(err instanceof ApiRequestError ? err.message : "Couldn't add that song.");
    } finally {
      setBusy(null);
    }
  }

  const options: { value: Source; label: string }[] = [
    { value: "search", label: "Search" },
    { value: "saved", label: "Saved" },
    ...(themed ? [{ value: "suggested" as const, label: "Suggested" }] : []),
  ];

  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
      <Segmented value={source} onChange={setSource} options={options} />
      {source === "search" ? (
        <TextInput
          autoFocus
          placeholder="Search songs or artists"
          placeholderTextColor={color.lose}
          value={q}
          onChangeText={setQ}
          style={styles.search}
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search songs"
        />
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      <FlatList
        data={list}
        keyExtractor={(h) => h.catalogId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space.sm, paddingBottom: space.xxl }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={color.violet} style={{ marginTop: space.xl }} />
          ) : source === "search" ? (
            q.trim().length >= 2 ? <EmptyState title="No matches" body="Try the artist name or a different spelling." /> : <EmptyState title="Find songs to add" body="Tap a song to add it to the end of the playlist." />
          ) : source === "saved" ? (
            <EmptyState title="No saved songs yet" body="Bookmark songs in battles and searches to find them here." />
          ) : (
            <EmptyState title="No suggestions" body="Try search instead." />
          )
        }
        renderItem={({ item }) => {
          const done = added.has(item.catalogId) || inPlaylist.has(item.catalogId);
          const playable = item.sources.some((s) => s.tier !== "LINK_OUT");
          return (
            <SongRow
              hit={item}
              playing={preview.currentId === item.catalogId}
              onPreview={() => preview.toggle(item)}
              onPress={() => void add(item)}
              disabled={done || !playable || busy === item.catalogId}
              selected={done}
              accessibilityLabel={`${done ? "Added: " : "Add "}${item.title} by ${item.artistName}`}
              right={
                busy === item.catalogId ? (
                  <ActivityIndicator color={color.violet} />
                ) : (
                  <Ionicons name={done ? "checkmark-circle" : "add-circle-outline"} size={26} color={done ? color.violet : color.text} />
                )
              }
            />
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, color: color.text, paddingHorizontal: space.md, fontSize: 17 },
});
