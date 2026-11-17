import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { color, space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Field } from "@/components/ui";
import { api } from "@/lib/api";

/** Paste a YouTube or YouTube Music playlist link; it becomes a VYBZ playlist you can battle from. */
export default function ImportPlaylist() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => "");
    if (text) setUrl(text.trim());
  };

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.importPlaylist(url.trim());
      router.replace({ pathname: "/playlist/[id]", params: { id: r.playlistId, imported: String(r.imported), skipped: String(r.skipped) } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text style={type.small}>
          In YouTube or YouTube Music, open a playlist, tap Share, then Copy link. Public and unlisted playlists work, up to 100 songs.
        </Text>
        <Field label="Playlist link" value={url} onChangeText={setUrl} placeholder="https://youtube.com/playlist?list=…" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Button title="Paste from clipboard" kind="ghost" onPress={() => void paste()} />
        {error ? <ErrorBanner message={error} /> : null}
        <Button title="Import" loading={busy} disabled={url.trim().length < 5} onPress={() => void go()} />
        {busy ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <ActivityIndicator color={color.violet} />
            <View style={{ flex: 1 }}>
              <Text style={type.body}>Matching songs…</Text>
              <Text style={type.small}>Each video is matched to its song so you can battle with it. Big playlists take up to a minute.</Text>
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
