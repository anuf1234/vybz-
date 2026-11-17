import { Ionicons } from "@expo/vector-icons";
import type { CatalogHit } from "@vybz/core";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { color } from "./theme";

/** The clip a picker can play inline: an Apple preview or a demo track. YouTube plays only in its own player. */
export function previewUrl(hit: CatalogHit): string | null {
  for (const s of hit.sources) if (s.tier === "PREVIEW" || s.tier === "HOSTED_FULL") return s.url;
  return null;
}

const PREVIEW_LIMIT_S = 30;

/** One shared player for a list of picker rows: starting a clip stops the last one. */
export function usePreviewPlayer() {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [currentId, setCurrentId] = useState<string | null>(null);

  // Previews stop at 30 seconds, and when they finish.
  useEffect(() => {
    if (!currentId) return;
    if (status.didJustFinish || (status.playing && status.currentTime >= PREVIEW_LIMIT_S)) {
      player.pause();
      setCurrentId(null);
    }
  }, [status.didJustFinish, status.currentTime, status.playing, currentId, player]);

  const toggle = useCallback(
    (hit: CatalogHit) => {
      const url = previewUrl(hit);
      if (!url) return;
      if (currentId === hit.catalogId) {
        player.pause();
        setCurrentId(null);
        return;
      }
      player.replace({ uri: url });
      player.play();
      setCurrentId(hit.catalogId);
    },
    [currentId, player],
  );

  const stop = useCallback(() => {
    player.pause();
    setCurrentId(null);
  }, [player]);

  return { currentId, toggle, stop };
}

export function PreviewButton({ hit, playing, onPress }: { hit: CatalogHit; playing: boolean; onPress: () => void }) {
  if (!previewUrl(hit)) return null;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${playing ? "Stop" : "Preview"} ${hit.title}`}
      style={[styles.btn, playing && { backgroundColor: color.violet }]}
    >
      <Ionicons name={playing ? "stop" : "play"} size={16} color={playing ? "#fff" : color.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: color.line, alignItems: "center", justifyContent: "center" },
});
