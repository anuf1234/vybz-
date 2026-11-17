import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { ago } from "@/lib/time";
import { useNow, useResource } from "@/lib/use-resource";

/** Your conversations, newest first. */
export default function Inbox() {
  const router = useRouter();
  const box = useResource(() => api.inbox(), [], { pollMs: 15_000 });
  const now = useNow(30_000);
  useFocusEffect(
    useCallback(() => {
      void box.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  if (box.loading && !box.data) return <Loading />;
  return (
    <FlatList
      data={box.data?.items ?? []}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={box.refreshing} onRefresh={() => void box.reload()} />}
      ListHeaderComponent={box.error ? <ErrorBanner message={box.error.message} onRetry={() => void box.reload()} /> : undefined}
      ListEmptyComponent={<EmptyState title="No messages yet" body="Open someone's profile and tap Message. You can message people once one of you follows the other." />}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: "/messages/[id]", params: { id: item.id } })} style={[styles.row, item.unread && styles.unread]} accessibilityRole="button" accessibilityLabel={`${item.unread ? "Unread. " : ""}Conversation with @${item.other.handle}`}>
          <Avatar name={item.other.displayName} image={item.other.image} size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.body, { fontWeight: item.unread ? "800" : "600" }]}>@{item.other.handle}</Text>
            <Text style={[type.small, item.unread && { color: color.text }]} numberOfLines={1}>
              {item.lastMessage ? `${item.lastMessage.fromMe ? "You: " : ""}${item.lastMessage.body}` : "No messages"}
            </Text>
          </View>
          {item.lastMessage ? <Text style={[type.small, { fontSize: 11 }]}>{ago(item.lastMessage.createdAt, now)}</Text> : null}
          {item.unread ? <View style={styles.dot} /> : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.line },
  unread: { borderColor: color.violet },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.live },
});
