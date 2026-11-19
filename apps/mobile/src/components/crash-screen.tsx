import type { ObserveErrorBoundaryFallbackProps } from "expo-observe";
import * as Updates from "expo-updates";
import { StyleSheet, Text, View } from "react-native";
import { color, space } from "./theme";
import { Button } from "./ui";

/**
 * Shown when a screen throws while rendering. The error has already been
 * sent to Expo Observe; this just gives the person a way back in.
 */
export function CrashScreen({ resetError }: ObserveErrorBoundaryFallbackProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>We've been told about it. Try again, or restart the app if it keeps happening.</Text>
      <Button title="Try again" onPress={resetError} />
      {Updates.isEnabled ? <Button title="Restart VYBZ" kind="ghost" onPress={() => void Updates.reloadAsync().catch(() => resetError())} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.ink, justifyContent: "center", padding: space.xl, gap: space.md },
  title: { color: color.text, fontSize: 22, fontWeight: "700" },
  body: { color: color.muted, fontSize: 15, lineHeight: 21, marginBottom: space.md },
});
