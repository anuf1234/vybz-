import type { AchievementView } from "@vybz/core";
import { Stack, useLocalSearchParams } from "expo-router";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

/** Someone's achievements; yours when no handle is given (notification links). */
export default function Achievements() {
  const params = useLocalSearchParams<{ handle?: string }>();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const me = useResource(!params.handle && signedIn ? () => api.me() : null, [params.handle, signedIn]);
  const handle = params.handle ?? me.data?.handle ?? null;
  const list = useResource(handle ? () => api.achievements(handle) : null, [handle]);

  if (!handle) {
    if (me.loading || session.isPending) return <Loading />;
    return <EmptyState title="Sign in to earn achievements" body="Battle, vote and share to unlock them." />;
  }
  return (
    <FlatList
      data={list.data?.items ?? []}
      keyExtractor={(i) => i.code}
      numColumns={2}
      columnWrapperStyle={{ gap: space.sm }}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={list.refreshing} onRefresh={() => void list.reload()} />}
      ListHeaderComponent={
        <View style={{ gap: space.sm, marginBottom: space.sm }}>
          <Stack.Screen options={{ title: params.handle ? `@${params.handle}` : "Achievements" }} />
          {list.data ? (
            <Text style={type.body}>
              <Text style={{ fontWeight: "800" }}>
                {list.data.unlocked} of {list.data.total}
              </Text>{" "}
              unlocked
            </Text>
          ) : null}
          {list.error ? <ErrorBanner message={list.error.message} onRetry={() => void list.reload()} /> : null}
        </View>
      }
      ListEmptyComponent={list.loading ? <Loading /> : undefined}
      renderItem={({ item }) => <Badge a={item} />}
    />
  );
}

function Badge({ a }: { a: AchievementView }) {
  const done = Boolean(a.unlockedAt);
  return (
    <View style={[styles.badge, done && styles.done]} accessible accessibilityLabel={`${a.title}. ${a.description} ${done ? "Unlocked" : `${a.progress} of ${a.target}`}`}>
      <Text style={[styles.icon, !done && { opacity: 0.35 }]}>{a.icon}</Text>
      <Text style={[type.body, { fontWeight: "800", textAlign: "center" }]} numberOfLines={1}>
        {a.title}
      </Text>
      <Text style={[type.small, { textAlign: "center" }]} numberOfLines={2}>
        {a.description}
      </Text>
      {done ? (
        <Text style={[type.small, { color: color.violetSoft, fontWeight: "700" }]}>Unlocked {new Date(a.unlockedAt!).toLocaleDateString()}</Text>
      ) : (
        <View style={{ alignSelf: "stretch", gap: 4 }}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round((a.progress / a.target) * 100)}%` }]} />
          </View>
          <Text style={[type.small, { textAlign: "center", fontSize: 11 }]}>
            {a.progress}/{a.target} · +{a.xp} XP · +{a.coins} 🪙
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flex: 1, alignItems: "center", gap: 4, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.line },
  done: { borderColor: color.violet },
  icon: { fontSize: 34 },
  track: { height: 6, borderRadius: 3, backgroundColor: color.line, overflow: "hidden" },
  fill: { height: 6, backgroundColor: color.violet },
});
