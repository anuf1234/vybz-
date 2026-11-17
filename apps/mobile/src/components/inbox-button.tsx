import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";
import { color } from "./theme";

/** Messages, with the number of unread conversations. */
export function InboxButton() {
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const box = useResource(signedIn ? () => api.inbox() : null, [signedIn], { pollMs: 30_000 });
  if (!signedIn) return null;
  const unread = box.data?.unread ?? 0;
  return (
    <Pressable onPress={() => router.push("/messages")} hitSlop={10} style={{ marginRight: 16 }} accessibilityRole="button" accessibilityLabel={unread ? `Messages, ${unread} unread` : "Messages"}>
      <Ionicons name="paper-plane-outline" size={22} color={color.text} />
      {unread ? (
        <View style={styles.badge}>
          <Text style={styles.text}>{unread > 9 ? "9+" : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { position: "absolute", top: -4, right: -8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color.live, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  text: { color: color.ink, fontSize: 11, fontWeight: "800" },
});
