import { type ArtistHit, type CatalogHit, themeLabel } from "@vybz/core";
import type { ProviderKind } from "@vybz/providers";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PreviewButton, usePreviewPlayer } from "@/components/preview-player";
import { color, radius, space, type } from "@/components/theme";
import { Artwork, Button, EmptyState, ErrorBanner, SectionTitle, Segmented } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useServerConfig } from "@/lib/config";
import { TIER_LABEL } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

/**
 * Picks for a round. With an empty search it suggests songs that fit the
 * battle's genres and era; searching shows matching artists and songs; an
 * artist opens their songs, most popular first. Select the agreed number of
 * tracks, in play order, then lock them in. Rows play a short preview.
 */
export default function Pick() {
  const { id, round } = useLocalSearchParams<{ id: string; round: string }>();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [songs, setSongs] = useState<CatalogHit[]>([]);
  const [artists, setArtists] = useState<ArtistHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [picked, setPicked] = useState<CatalogHit[]>([]);
  const [artistId, setArtistId] = useState<string | null>(null);
  const battle = useResource(() => api.battle(id), [id]);
  const rules = battle.data?.rules;
  const need = rules?.tracksPerRound ?? 1;
  const c = rules?.constraints;
  const theme = rules ? themeLabel(c) : null;
  const config = useServerConfig();
  const catalogs = config?.catalogs ?? [];
  const [source, setSource] = useState<ProviderKind | null>(null);
  const activeSource = source ?? catalogs[0]?.provider ?? null;
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const preview = usePreviewPlayer();

  const suggestions = useResource(rules ? () => api.suggestions({ genres: c?.genres, eraFrom: c?.eraFrom, eraTo: c?.eraTo }) : null, [rules ? JSON.stringify(c ?? {}) : null]);
  const artist = useResource(artistId ? () => api.artist(artistId) : null, [artistId]);

  // Debounced search: songs from the chosen catalog, artists alongside.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setSongs([]);
      setArtists([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const [s, a] = await Promise.all([api.search(term, activeSource ?? undefined), api.artists(term).catch(() => ({ items: [] as ArtistHit[] }))]);
        if (mine === seq.current) {
          setSongs(s.items);
          setArtists(activeSource === "YOUTUBE" ? [] : a.items);
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

  // Leaving the screen or switching lists stops the preview.
  useEffect(() => preview.stop, [preview.stop]);

  function eraProblem(hit: CatalogHit): string | null {
    if (!c || (c.eraFrom === undefined && c.eraTo === undefined)) return null;
    if (!hit.releaseYear) return "No release year";
    if ((c.eraFrom !== undefined && hit.releaseYear < c.eraFrom) || (c.eraTo !== undefined && hit.releaseYear > c.eraTo)) return `Outside ${theme ?? "the era"}`;
    return null;
  }

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
    preview.stop();
    try {
      await api.submit(id, Number(round), picked.map((p) => p.catalogId));
      router.back();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't submit those picks.");
    } finally {
      setSubmitting(false);
    }
  }

  const searchingNow = q.trim().length >= 2;
  const viewingArtist = artistId !== null;
  const list: CatalogHit[] = viewingArtist ? (artist.data?.topSongs ?? []) : searchingNow ? songs : (suggestions.data?.items ?? []);
  const loading = viewingArtist ? artist.loading && !artist.data : searchingNow ? searching : suggestions.loading && !suggestions.data;

  const header = viewingArtist ? (
    <View style={{ gap: space.sm, marginBottom: space.sm }}>
      <Pressable onPress={() => setArtistId(null)} accessibilityRole="button" hitSlop={8}>
        <Text style={[type.small, { color: color.violetSoft }]}>‹ Back</Text>
      </Pressable>
      {artist.data ? (
        <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
          <Artwork uri={artist.data.artist.artworkUrl} size={64} round />
          <View style={{ flex: 1 }}>
            <Text style={type.heading}>{artist.data.artist.name}</Text>
            <Text style={type.small}>{artist.data.artist.genres.slice(0, 2).join(" · ") || "Artist"}</Text>
          </View>
        </View>
      ) : null}
      {artist.error ? <ErrorBanner message={artist.error.message} onRetry={() => void artist.reload()} /> : null}
      {artist.data?.topSongs.length ? <SectionTitle>Top songs</SectionTitle> : null}
    </View>
  ) : searchingNow ? (
    artists.length ? (
      <View style={{ gap: space.sm, marginBottom: space.sm }}>
        <SectionTitle>Artists</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
          {artists.map((a) => (
            <Pressable key={a.artistId} onPress={() => setArtistId(a.artistId)} style={styles.artist} accessibilityRole="button" accessibilityLabel={`Open ${a.name}`}>
              <Artwork uri={a.artworkUrl} size={72} round />
              <Text style={[type.small, { color: color.text, textAlign: "center" }]} numberOfLines={2}>
                {a.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {songs.length ? <SectionTitle>Songs</SectionTitle> : null}
      </View>
    ) : null
  ) : suggestions.data?.items.length ? (
    <SectionTitle>{suggestions.data.title}</SectionTitle>
  ) : null;

  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
      <TextInput
        placeholder="Search songs or artists"
        placeholderTextColor={color.lose}
        value={q}
        onChangeText={(t) => {
          setQ(t);
          setArtistId(null);
        }}
        style={styles.search}
        returnKeyType="search"
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Search songs"
      />
      {catalogs.length > 1 && activeSource && searchingNow && !viewingArtist ? (
        <Segmented value={activeSource} onChange={(v) => setSource(v)} options={catalogs.map((cat) => ({ value: cat.provider, label: cat.label }))} />
      ) : null}
      {activeSource === "YOUTUBE" && catalogs.length > 1 && searchingNow && !viewingArtist ? (
        <Text style={type.small}>YouTube picks are matched to Apple Music when possible, so everyone can hear them either way.</Text>
      ) : null}
      {theme ? <Text style={type.small}>This battle is {theme}. Picks must fit.</Text> : null}
      {error ? <ErrorBanner message={error} /> : null}
      <FlatList
        data={list}
        keyExtractor={(h) => h.catalogId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space.sm, paddingBottom: space.xxl }}
        ListHeaderComponent={header ?? undefined}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={color.violet} style={{ marginTop: space.xl }} />
          ) : viewingArtist ? (
            artist.data ? <EmptyState title="No songs found" body="This artist has no songs available here." /> : undefined
          ) : searchingNow ? (
            artists.length ? undefined : <EmptyState title="No matches" body="Try the artist name or a different spelling." />
          ) : (
            <EmptyState
              title={need > 1 ? `Find your ${need} picks` : "Find your pick"}
              body={`Search for a song or an artist. Your opponent won't see ${need > 1 ? "them" : "it"} until voting opens.${need > 1 ? " They play in the order you pick them." : ""}`}
            />
          )
        }
        renderItem={({ item, index }) => {
          const best = item.sources[0];
          const playable = item.sources.some((s) => s.tier !== "LINK_OUT");
          const problem = eraProblem(item);
          const disabled = submitting || !playable || problem !== null;
          const order = picked.findIndex((p) => p.catalogId === item.catalogId);
          return (
            <Pressable
              onPress={() => toggle(item)}
              disabled={disabled}
              style={({ pressed }) => [styles.row, order >= 0 && styles.rowPicked, pressed && { opacity: 0.8 }, disabled && { opacity: 0.5 }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: order >= 0, disabled }}
              accessibilityLabel={`${viewingArtist ? `Number ${index + 1}, ` : ""}${item.title} by ${item.artistName}`}
            >
              {viewingArtist ? <Text style={styles.rank}>{index + 1}</Text> : null}
              <Artwork uri={item.artworkUrl} size={52} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
                  {item.title}
                  {item.explicit ? " 🅴" : ""}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {viewingArtist ? item.albumName ?? item.artistName : item.artistName}
                  {item.releaseYear ? ` · ${item.releaseYear}` : ""}
                </Text>
                {best && !problem ? <Text style={[type.small, { fontSize: 11, letterSpacing: 0.5 }]}>{TIER_LABEL[best.tier].toUpperCase()}</Text> : null}
                {problem ? <Text style={[type.small, { color: color.danger }]}>{problem}</Text> : null}
              </View>
              <PreviewButton hit={item} playing={preview.currentId === item.catalogId} onPress={() => preview.toggle(item)} />
              {order >= 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{need > 1 ? order + 1 : "✓"}</Text>
                </View>
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
  rank: { width: 22, textAlign: "center", color: color.muted, fontWeight: "800", fontSize: 15 },
  artist: { width: 84, alignItems: "center", gap: 6 },
});
