import { frameColor } from "@vybz/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { FollowButton } from "@/components/follow-button";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

/** Someone's followers or the people they follow. */
export default function Follows() {
  const { handle, which } = useLocalSearchParams<{ handle: string; which: "followers" | "following" }>();
  const router = useRouter();
  const session = useSession();
  const list = useResource(() => api.followList(handle, which === "following" ? "following" : "followers"), [handle, which]);
  if (list.loading && !list.data) return <Loading />;
  return (
    <FlatList
      data={list.data?.items ?? []}
      keyExtractor={(u) => u.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      ListHeaderComponent={
        <>
          <Stack.Screen options={{ title: which === "following" ? `@${handle} follows` : `@${handle}'s followers` }} />
          {list.error ? <ErrorBanner message={list.error.message} onRetry={() => void list.reload()} /> : null}
        </>
      }
      ListEmptyComponent={<EmptyState title={which === "following" ? "Not following anyone yet" : "No followers yet"} />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Pressable onPress={() => router.push({ pathname: "/user/[handle]", params: { handle: item.handle } })} style={styles.who} accessibilityRole="link" accessibilityLabel={`@${item.handle}`}>
            <Avatar name={item.displayName} image={item.image} size={40} ring={frameColor(item.frame)} />
            <View style={{ flexShrink: 1 }}>
              <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
                {item.displayName}
              </Text>
              <Text style={type.small}>@{item.handle}</Text>
            </View>
          </Pressable>
          {session.data && item.id !== session.data.user.id ? <FollowButton handle={item.handle} following={item.viewerFollows} compact /> : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, padding: space.sm, borderRadius: radius.md, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.line },
  who: { flexDirection: "row", alignItems: "center", gap: space.md, flexShrink: 1 },
});
