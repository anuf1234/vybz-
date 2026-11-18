import type { GifView } from "@vybz/core";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useServerConfig } from "@/lib/config";
import { type GifResult, searchGifs, toGif } from "@/lib/giphy";
import { color, radius, space, type } from "./theme";

/** A GIF in a message, post or comment, sized to fit. */
export function Gif({ gif, maxWidth = 240 }: { gif: GifView; maxWidth?: number }) {
  const w = Math.min(maxWidth, gif.width);
  return (
    <Image
      source={{ uri: gif.url }}
      style={{ width: w, height: (w * gif.height) / gif.width, borderRadius: radius.md, backgroundColor: color.surface2 }}
      contentFit="cover"
      autoplay
      accessibilityLabel={gif.title ? `GIF: ${gif.title}` : "GIF"}
    />
  );
}

/** The GIF button: hidden when the server has no GIPHY key. */
export function GifButton({ onPick, compact }: { onPick: (gif: GifView) => void; compact?: boolean }) {
  const config = useServerConfig();
  const [open, setOpen] = useState(false);
  if (!config?.giphy) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Add a GIF" style={[styles.gifBtn, compact && { paddingHorizontal: 8 }]}>
        <Text style={{ color: color.text, fontWeight: "900", fontSize: 12, letterSpacing: 1 }}>GIF</Text>
      </Pressable>
      <GifPicker
        visible={open}
        apiKey={config.giphy.apiKey}
        onClose={() => setOpen(false)}
        onPick={(g) => {
          setOpen(false);
          onPick(g);
        }}
      />
    </>
  );
}

function GifPicker({ visible, apiKey, onClose, onPick }: { visible: boolean; apiKey: string; onClose: () => void; onPick: (gif: GifView) => void }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const t = setTimeout(
      () => {
        setLoading(true);
        setError(null);
        searchGifs(apiKey, query)
          .then((r) => alive && setItems(r))
          .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
          .finally(() => alive && setLoading(false));
      },
      query ? 350 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [visible, query, apiKey]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search GIPHY"
            placeholderTextColor={color.muted}
            autoFocus
            autoCorrect={false}
            style={styles.search}
            accessibilityLabel="Search GIFs"
          />
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}>
            <Text style={[type.body, { fontWeight: "700" }]}>Cancel</Text>
          </Pressable>
        </View>
        {error ? <Text style={[type.small, { color: color.danger, padding: space.md }]}>{error}</Text> : null}
        <FlatList
          data={items}
          keyExtractor={(g) => g.id}
          numColumns={2}
          columnWrapperStyle={{ gap: space.xs }}
          contentContainerStyle={{ gap: space.xs, padding: space.sm }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={loading ? <ActivityIndicator color={color.violet} style={{ marginTop: space.xl }} /> : <Text style={[type.small, { textAlign: "center", marginTop: space.xl }]}>No GIFs found.</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => onPick(toGif(item))} accessibilityRole="button" accessibilityLabel={item.title || "GIF"} style={{ flex: 1 }}>
              <Image source={{ uri: item.previewUrl }} style={{ width: "100%", aspectRatio: item.width / item.height, borderRadius: radius.sm, backgroundColor: color.surface2 }} contentFit="cover" autoplay />
            </Pressable>
          )}
        />
        {/* GIPHY's terms: attribution wherever its GIFs are searched. */}
        <Text style={styles.attribution}>Powered by GIPHY</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gifBtn: { borderWidth: 1.5, borderColor: color.line, borderRadius: radius.sm, paddingHorizontal: 10, minHeight: 34, justifyContent: "center", backgroundColor: color.surface2 },
  sheet: { flex: 1, backgroundColor: color.ink },
  head: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  search: { flex: 1, minHeight: 42, borderRadius: radius.md, backgroundColor: color.surface2, color: color.text, paddingHorizontal: space.md },
  attribution: { textAlign: "center", color: color.muted, fontWeight: "800", fontSize: 12, letterSpacing: 1, padding: space.md },
});
