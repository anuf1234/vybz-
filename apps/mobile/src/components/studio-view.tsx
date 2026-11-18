import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { color } from "@/components/theme";
import { studioHandoffToken, useSession } from "@/lib/auth-client";
import { API_URL } from "@/lib/config";

export type StudioMessage = { type: string; [k: string]: unknown };

/**
 * DJ Vybz Studio runs in the browser engine (Web Audio). This opens it in the
 * app, signed in with a one-time token, with the app's own navigation.
 */
export function StudioView({ path, onMessage }: { path: string; onMessage?: (m: StudioMessage) => void }) {
  const session = useSession();
  const [uri, setUri] = useState<string | null>(null);
  const signedIn = Boolean(session.data);

  useEffect(() => {
    if (session.isPending) return;
    let alive = true;
    const next = `${path}${path.includes("?") ? "&" : "?"}embed=app`;
    void (async () => {
      const token = signedIn ? await studioHandoffToken() : null;
      if (!alive) return;
      setUri(token ? `${API_URL}/studio/handoff?t=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}` : `${API_URL}${next}`);
    })();
    return () => {
      alive = false;
    };
  }, [path, signedIn, session.isPending]);

  if (!uri) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.violet} />
      </View>
    );
  }
  return (
    <WebView
      source={{ uri }}
      style={{ flex: 1, backgroundColor: color.ink }}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      sharedCookiesEnabled
      originWhitelist={[API_URL]}
      setSupportMultipleWindows={false}
      onMessage={(e: WebViewMessageEvent): void => {
        try {
          onMessage?.(JSON.parse(e.nativeEvent.data) as StudioMessage);
        } catch {
          // Not ours.
        }
      }}
      startInLoadingState
      renderLoading={() => (
        <View style={styles.center}>
          <ActivityIndicator color={color.violet} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: color.ink },
});
