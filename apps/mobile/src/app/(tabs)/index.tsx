import type { BattleListItem } from "@vybz/core";
import { Link } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { BattleCard } from "@/components/battle-card";
import { color, space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useNow, useResource } from "@/lib/use-resource";

export default function Home() {
  const session = useSession();
  const signedIn = Boolean(session.data);
  const vote = useResource(() => api.battles("vote"), [signedIn], { pollMs: 20_000 });
  const feed = useResource(() => api.battles("home"), [signedIn], { pollMs: 30_000 });
  const now = useNow(1000);

  const voteIds = new Set(vote.data?.items.map((b) => b.id));
  const rest = (feed.data?.items ?? []).filter((b) => !voteIds.has(b.id));
  const live = rest.filter((b) => b.status === "IN_PROGRESS");
  const done = rest.filter((b) => b.status === "COMPLETE");
  const open = rest.filter((b) => b.status === "OPEN_CHALLENGE");

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={feed.refreshing} onRefresh={() => void Promise.all([feed.reload(), vote.reload()])} />}
    >
      <View style={{ gap: space.xs }}>
        <Text style={[type.display, { fontSize: 30 }]}>BATTLE YOUR TASTE.</Text>
        <Text style={type.small}>Two picks, one crowd. Listen to both, then vote.</Text>
      </View>
      {!signedIn && !session.isPending ? (
        <Link href="/sign-up" asChild>
          <Button title="Join VYBZ" />
        </Link>
      ) : null}

      {feed.error ? <ErrorBanner message={feed.error.message} onRetry={() => void feed.reload()} /> : null}
      {feed.loading && !feed.data ? <Loading /> : null}

      <List title="Your vote counts" items={vote.data?.items ?? []} now={now} />
      <List title="Live now" items={live} now={now} />
      <List title="Open challenges" items={open} now={now} />
      <List title="Recent results" items={done} now={now} />

      {feed.data && !feed.data.items.length ? (
        <EmptyState
          title="No battles yet"
          body="Start one: pick a theme and challenge someone."
          action={
            <Link href="/create" asChild>
              <Button title="Start a battle" />
            </Link>
          }
        />
      ) : null}
    </ScrollView>
  );
}

function List({ title, items, now }: { title: string; items: BattleListItem[]; now: number }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: space.md }}>
      <SectionTitle>{title}</SectionTitle>
      {items.map((b) => (
        <BattleCard key={b.id} battle={b} now={now} />
      ))}
    </View>
  );
}
