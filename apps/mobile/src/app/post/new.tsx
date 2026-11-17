import type { CatalogHit } from "@vybz/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { usePreviewPlayer } from "@/components/preview-player";
import { SongRow } from "@/components/song-row";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, ErrorBanner } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";

const MAX = 1000;

/**
 * Write a post. Share buttons open this with something attached
 * (?catalogId= or ?trackId= with &label=, ?playlistId=, ?battleId=);
 * otherwise you can attach a song from search.
 */
export default function NewPost() {
  const params = useLocalSearchParams<{ catalogId?: string; trackId?: string; playlistId?: string; battleId?: string; label?: string }>();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [song, setSong] = useState<CatalogHit | null>(null);
  const [finding, setFinding] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const preview = usePreviewPlayer();

  const preset = params.playlistId
    ? { kind: "Playlist", body: { playlistId: params.playlistId } }
    : params.battleId
      ? { kind: "Battle", body: { battleId: params.battleId } }
      : params.trackId
        ? { kind: "Song", body: { trackId: params.trackId } }
        : params.catalogId
          ? { kind: "Song", body: { catalogId: params.catalogId } }
          : null;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setResults([]);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.search(term);
        if (mine === seq.current) setResults(res.items.slice(0, 8));
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => preview.stop, [preview.stop]);

  async function publish() {
    setBusy(true);
    setError(null);
    preview.stop();
    try {
      const attach = preset ? preset.body : song ? { catalogId: song.catalogId } : {};
      const { id } = await api.createPost({ body, ...attach });
      router.replace({ pathname: "/post/[id]", params: { id } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't post that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <TextInput
          autoFocus
          multiline
          placeholder={preset || song ? "Say something about it…" : "What's on your playlist today?"}
          placeholderTextColor={color.lose}
          value={body}
          onChangeText={setBody}
          maxLength={MAX}
          style={styles.input}
          accessibilityLabel="Post text"
        />
        <Text style={[type.small, { textAlign: "right" }]}>
          {body.length}/{MAX}
        </Text>

        {preset ? (
          <Card>
            <Text style={type.label}>Attached {preset.kind.toLowerCase()}</Text>
            <Text style={type.body}>{params.label ?? preset.kind}</Text>
          </Card>
        ) : song ? (
          <View style={{ gap: space.xs }}>
            <SongRow hit={song} playing={preview.currentId === song.catalogId} onPreview={() => preview.toggle(song)} />
            <Pressable onPress={() => setSong(null)} accessibilityRole="button" hitSlop={8}>
              <Text style={[type.small, { color: color.danger }]}>Remove song</Text>
            </Pressable>
          </View>
        ) : finding ? (
          <View style={{ gap: space.sm }}>
            <TextInput
              autoFocus
              placeholder="Search for a song to attach"
              placeholderTextColor={color.lose}
              value={q}
              onChangeText={setQ}
              style={styles.search}
              autoCorrect={false}
              accessibilityLabel="Search songs"
            />
            {searching ? <ActivityIndicator color={color.violet} /> : null}
            {results.map((r) => (
              <SongRow
                key={r.catalogId}
                hit={r}
                playing={preview.currentId === r.catalogId}
                onPreview={() => preview.toggle(r)}
                onPress={() => {
                  setSong(r);
                  setFinding(false);
                }}
                accessibilityLabel={`Attach ${r.title} by ${r.artistName}`}
              />
            ))}
          </View>
        ) : (
          <Button title="Attach a song" kind="secondary" onPress={() => setFinding(true)} />
        )}

        {error ? <ErrorBanner message={error} /> : null}
        <Button title="Post" onPress={() => void publish()} loading={busy} disabled={!body.trim()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 120, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, color: color.text, padding: space.md, fontSize: 17, textAlignVertical: "top" },
  search: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, color: color.text, paddingHorizontal: space.md, fontSize: 16 },
});
