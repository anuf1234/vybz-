import type { TriviaLeaderboardPeriod } from "@vybz/core";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { TriviaLeader } from "@/components/chips";
import { color, space, type } from "@/components/theme";
import { EmptyState, ErrorBanner, Loading, Segmented } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** Daily trivia scores: today, this week (sum of daily scores) or all time. */
export default function TriviaLeaderboard() {
  const [period, setPeriod] = useState<TriviaLeaderboardPeriod>("today");
  const [scope, setScope] = useState<"global" | "following">("global");
  const board = useResource(() => api.triviaLeaderboard(period, scope), [period, scope]);
  const b = board.data;
  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={board.refreshing} onRefresh={() => void board.reload()} />}
    >
      <Segmented
        value={period}
        onChange={setPeriod}
        options={[
          { value: "today", label: "Today" },
          { value: "week", label: "This week" },
          { value: "all", label: "All time" },
        ]}
      />
      <Segmented
        value={scope}
        onChange={setScope}
        options={[
          { value: "global", label: "Everyone" },
          { value: "following", label: "Following" },
        ]}
      />
      {board.error ? <ErrorBanner message={board.error.message} onRetry={() => void board.reload()} /> : null}
      {!b ? <Loading /> : null}
      {b && b.you && !b.rows.some((r) => r.isYou) ? (
        <View style={{ gap: space.xs }}>
          <Text style={type.label}>You</Text>
          <TriviaLeader row={b.you} />
        </View>
      ) : null}
      {b && !b.rows.length ? <EmptyState title="No scores yet" body="Play the daily trivia to get on the board." /> : null}
      {b?.rows.map((r) => <TriviaLeader key={r.user.id} row={r} />)}
      {b ? <Text style={[type.small, { textAlign: "center" }]}>Daily challenge scores only. Weekly and all-time add up your daily scores.</Text> : null}
    </ScrollView>
  );
}
