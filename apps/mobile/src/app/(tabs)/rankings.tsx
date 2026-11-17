import { Link } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { color, space, type } from "@/components/theme";
import { Avatar, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

export default function Rankings() {
  const r = useResource(() => api.rankings(), []);
  if (r.loading && !r.data) return <Loading />;
  return (
    <FlatList
      data={r.data?.items ?? []}
      keyExtractor={(e) => e.user.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={r.refreshing} onRefresh={() => void r.reload()} />}
      ListHeaderComponent={
        <View style={{ gap: space.sm, marginBottom: space.sm }}>
          {r.error ? <ErrorBanner message={r.error.message} onRetry={() => void r.reload()} /> : null}
          <Text style={type.small}>Ranked by battles won, then rounds won. Season ratings are coming.</Text>
        </View>
      }
      ListEmptyComponent={<EmptyState title="No finished battles yet" body="Win one and you're on the board." />}
      renderItem={({ item }) => (
        <Link href={{ pathname: "/user/[handle]", params: { handle: item.user.handle } }} asChild>
          <Pressable style={styles.row} accessibilityRole="link" accessibilityLabel={`Rank ${item.rank}, ${item.user.handle}, ${item.wins} wins`}>
            <Text style={[type.display, styles.rank, item.rank <= 3 && { color: color.violetSoft }]}>{item.rank}</Text>
            <Avatar name={item.user.displayName} size={38} />
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: "700" }]}>@{item.user.handle}</Text>
              <Text style={type.small}>
                {item.wins}W · {item.losses}L{item.draws ? ` · ${item.draws}D` : ""} · {item.roundsWon} rounds
              </Text>
            </View>
          </Pressable>
        </Link>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.surface1, borderRadius: 14, borderWidth: 1, borderColor: color.line, padding: space.md },
  rank: { fontSize: 24, width: 34, textAlign: "center" },
});
