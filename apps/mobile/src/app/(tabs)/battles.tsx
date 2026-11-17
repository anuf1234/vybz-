import type { BattleFeed } from "@vybz/core";
import { Link } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { BattleCard } from "@/components/battle-card";
import { color, space } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading, Segmented } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useNow, useResource } from "@/lib/use-resource";

export default function Battles() {
  const session = useSession();
  const signedIn = Boolean(session.data);
  const [tab, setTab] = useState<BattleFeed>(signedIn ? "mine" : "open");
  const feed = useResource(() => api.battles(tab), [tab, signedIn], { pollMs: 15_000 });
  const now = useNow(1000);

  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "mine", label: "Mine" },
          { value: "open", label: "Open" },
          { value: "vote", label: "To vote" },
        ]}
      />
      {feed.error ? <ErrorBanner message={feed.error.message} onRetry={() => void feed.reload()} /> : null}
      {tab === "mine" && !signedIn ? (
        <EmptyState
          title="Sign in to see your battles"
          action={
            <Link href="/sign-in" asChild>
              <Button title="Sign in" />
            </Link>
          }
        />
      ) : feed.loading && !feed.data ? (
        <Loading />
      ) : (
        <FlatList
          data={feed.data?.items ?? []}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}
          refreshControl={<RefreshControl tintColor={color.violet} refreshing={feed.refreshing} onRefresh={() => void feed.reload()} />}
          renderItem={({ item }) => <BattleCard battle={item} now={now} />}
          ListEmptyComponent={
            <EmptyState
              title={tab === "mine" ? "No battles yet" : tab === "open" ? "No open challenges" : "Nothing to vote on"}
              body={tab === "open" ? "Post an open challenge and anyone can take you on." : undefined}
              action={
                tab !== "vote" ? (
                  <Link href="/create" asChild>
                    <Button title="Start a battle" kind="secondary" />
                  </Link>
                ) : undefined
              }
            />
          }
        />
      )}
    </View>
  );
}
