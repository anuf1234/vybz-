import { GENRES, type LeaderboardEntry, type LeaderboardMetric, type LeaderboardPeriod } from "@vybz/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, EmptyState, ErrorBanner, Loading, SectionTitle, Segmented } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

/** "global", "following", or a genre key. */
type Board = string;

export default function Rankings() {
  const session = useSession();
  const signedIn = Boolean(session.data);
  const [board, setBoard] = useState<Board>("global");
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [metric, setMetric] = useState<LeaderboardMetric>("wins");
  const scope = board === "global" || board === "following" ? board : "genre";
  const lb = useResource(() => api.leaderboard({ scope, genre: scope === "genre" ? board : null, period, metric }), [board, period, metric, signedIn]);
  const me = lb.data?.me ?? null;
  const meShown = me && lb.data?.items.some((e) => e.user.id === me.user.id);
  const unit = metric === "wins" ? "wins" : metric === "rounds" ? "rounds" : "XP";

  return (
    <FlatList
      data={lb.data?.items ?? []}
      keyExtractor={(e) => e.user.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={lb.refreshing} onRefresh={() => void lb.reload()} />}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            <Chip label="Global" active={board === "global"} onPress={() => setBoard("global")} />
            {signedIn ? <Chip label="Following" active={board === "following"} onPress={() => setBoard("following")} /> : null}
            {GENRES.map((g) => (
              <Chip key={g.key} label={g.label} active={board === g.key} onPress={() => setBoard(g.key)} />
            ))}
          </ScrollView>
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[
              { value: "week", label: "This week" },
              { value: "month", label: "30 days" },
              { value: "all", label: "All time" },
            ]}
          />
          <Segmented
            value={metric}
            onChange={setMetric}
            options={[
              { value: "wins", label: "Battles won" },
              { value: "rounds", label: "Rounds won" },
            ]}
          />
          {lb.error ? <ErrorBanner message={lb.error.message} onRetry={() => void lb.reload()} /> : null}
          {me && !meShown ? (
            <>
              <SectionTitle>You</SectionTitle>
              <Row e={me} unit={unit} mine />
              <SectionTitle>Top 50</SectionTitle>
            </>
          ) : null}
        </View>
      }
      ListEmptyComponent={lb.loading && !lb.data ? <Loading /> : <EmptyState title="No results yet" body="Finished battles in this period show up here." />}
      renderItem={({ item }) => <Row e={item} unit={unit} mine={item.user.id === me?.user.id} />}
    />
  );
}

function Row({ e, unit, mine }: { e: LeaderboardEntry; unit: string; mine?: boolean }) {
  const router = useRouter();
  const medal = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/user/[handle]", params: { handle: e.user.handle } })}
      style={[styles.row, mine && styles.mine]}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${e.rank}, @${e.user.handle}, ${e.value} ${unit}`}
    >
      <Text style={styles.rank}>{medal ?? e.rank}</Text>
      <Avatar name={e.user.displayName} image={e.user.image} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
          @{e.user.handle}
          {e.level ? <Text style={type.small}> · Lv {e.level}</Text> : null}
        </Text>
        <Text style={type.small}>
          {e.wins}–{e.losses}
          {e.draws ? `–${e.draws}` : ""} · {e.roundsWon} rounds
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[type.display, { fontSize: 22 }]}>{e.value}</Text>
        <Text style={[type.small, { fontSize: 11 }]}>{unit}</Text>
      </View>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
      <Text style={{ color: active ? color.text : color.muted, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.line },
  mine: { borderColor: color.violet },
  rank: { width: 30, textAlign: "center", fontWeight: "800", fontSize: 16, color: color.text },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  chipActive: { borderColor: color.violet, backgroundColor: color.plum },
});
