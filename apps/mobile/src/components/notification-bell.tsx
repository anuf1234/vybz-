import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";
import { color } from "./theme";

export function NotificationBell() {
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const n = useResource(signedIn ? () => api.notifications() : null, [signedIn], { pollMs: 30_000 });
  if (!signedIn) return null;
  const unread = n.data?.unread ?? 0;
  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}
      hitSlop={10}
      style={{ marginRight: 16 }}
    >
      <Ionicons name="notifications-outline" size={24} color={color.text} />
      {unread ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { position: "absolute", top: -4, right: -8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color.live, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: color.ink, fontSize: 11, fontWeight: "800" },
});
