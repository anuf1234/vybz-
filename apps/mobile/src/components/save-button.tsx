import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet } from "react-native";
import { ApiRequestError } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { isSaved, toggleSaved, useLibraryVersion } from "@/lib/library-store";
import { color } from "./theme";

/** Save a song to your library, or remove it. Hidden when signed out. */
export function SaveButton({ song, size = 34 }: { song: { trackId?: string; catalogId?: string; title: string }; size?: number }) {
  const session = useSession();
  const signedIn = Boolean(session.data);
  useLibraryVersion(signedIn);
  const [busy, setBusy] = useState(false);
  if (!signedIn) return null;
  const saved = isSaved(song);
  const toggle = async () => {
    setBusy(true);
    try {
      const now = await toggleSaved(song);
      if (now && Platform.OS !== "web") void Haptics.selectionAsync();
    } catch (err) {
      Alert.alert("Couldn't update your library", err instanceof ApiRequestError ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pressable
      onPress={() => void toggle()}
      disabled={busy}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
      accessibilityLabel={saved ? `Remove ${song.title} from saved songs` : `Save ${song.title}`}
      style={[styles.btn, { width: size, height: size, borderRadius: size / 2 }, saved && { borderColor: color.violet }]}
    >
      <Ionicons name={saved ? "bookmark" : "bookmark-outline"} size={size * 0.5} color={saved ? color.violet : color.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { borderWidth: 1, borderColor: color.line, alignItems: "center", justifyContent: "center" },
});
