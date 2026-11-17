import { EARN, type WalletEntry, type WalletResponse } from "@vybz/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { LevelBadge } from "@/components/progress-card";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { ago } from "@/lib/time";
import { useResource } from "@/lib/use-resource";

const WAYS: [string, string][] = [
  ["Finish a battle", `+${EARN.battlePlayed.xp} XP · +${EARN.battlePlayed.coins} coins`],
  ["Win it", `+${EARN.battleWon.xp} XP · +${EARN.battleWon.coins} coins`],
  ["Each round you win", `+${EARN.roundWon.xp} XP`],
  ["Vote in a round", `+${EARN.vote.xp} XP (up to ${EARN.votesPerDay} a day)`],
  ["Share a post", `+${EARN.post.xp} XP (up to ${EARN.postsPerDay} a day)`],
  ["Daily reward", "up to +75 XP · +50 coins on day 7"],
  ["Achievements and level-ups", "bonus XP and coins"],
];

/** Your XP, level, coins, how to earn more, and the history. */
export default function Wallet() {
  const session = useSession();
  const signedIn = Boolean(session.data);
  const router = useRouter();
  const first = useResource(signedIn ? () => api.wallet() : null, [signedIn]);
  const [more, setMore] = useState<{ items: WalletEntry[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  if (session.isPending) return <Loading />;
  if (!signedIn) return <EmptyState title="Sign in to earn XP and coins" body="Battle, vote and claim your daily reward." />;
  const w = first.data;
  const items = [...(w?.history ?? []), ...(more?.items ?? [])];
  const cursor = more ? more.cursor : (w?.nextCursor ?? null);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.wallet(cursor);
      setMore((m) => ({ items: [...(m?.items ?? []), ...next.history], cursor: next.nextCursor }));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <FlatList
      data={items}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }}
      refreshControl={
        <RefreshControl
          tintColor={color.violet}
          refreshing={first.refreshing}
          onRefresh={() => {
            setMore(null);
            void first.reload();
          }}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.sm }}>
          {first.error ? <ErrorBanner message={first.error.message} onRetry={() => void first.reload()} /> : null}
          {w ? <Balance w={w} /> : first.loading ? <Loading /> : null}
          <Button title="🛍️ Spend coins in the shop" kind="secondary" onPress={() => router.push("/shop")} />
          <Card style={{ gap: space.sm }}>
            <Text style={type.heading}>How to earn</Text>
            {WAYS.map(([what, pays]) => (
              <View key={what} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                <Text style={[type.body, { flex: 1 }]}>{what}</Text>
                <Text style={[type.small, { color: color.violetSoft, fontWeight: "700" }]}>{pays}</Text>
              </View>
            ))}
          </Card>
          {items.length ? <SectionTitle>History</SectionTitle> : null}
        </View>
      }
      ListEmptyComponent={w ? <EmptyState title="Nothing yet" body="Your first battle, vote or daily reward shows up here." /> : undefined}
      renderItem={({ item }) => <Row e={item} />}
      ListFooterComponent={cursor ? <Button kind="secondary" title="Load more" loading={loadingMore} onPress={() => void loadMore()} /> : undefined}
    />
  );
}

function Balance({ w }: { w: WalletResponse }) {
  const pct = w.nextLevelXp === null ? 1 : (w.xp - w.levelXp) / (w.nextLevelXp - w.levelXp);
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <LevelBadge level={w.level} size={56} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.heading}>Level {w.level}</Text>
          <Text style={type.small}>{w.nextLevelXp === null ? "Max level" : `${w.nextLevelXp - w.xp} XP to level ${w.level + 1}`}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[type.display, { fontSize: 26 }]}>🪙 {w.coins}</Text>
          <Text style={type.small}>{w.xp} XP total</Text>
        </View>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
    </Card>
  );
}

function Row({ e }: { e: WalletEntry }) {
  const router = useRouter();
  const parts = [e.xp ? `+${e.xp} XP` : null, e.coins ? `+${e.coins} 🪙` : null].filter(Boolean).join(" · ");
  return (
    <Pressable onPress={e.link ? () => router.push(e.link as never) : undefined} disabled={!e.link} style={styles.row} accessibilityRole={e.link ? "link" : undefined}>
      <View style={{ flex: 1 }}>
        <Text style={type.body} numberOfLines={2}>
          {e.label}
        </Text>
        <Text style={type.small}>{ago(e.createdAt)}</Text>
      </View>
      <Text style={[type.body, { fontWeight: "800", color: color.violetSoft }]}>{parts}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.line },
  track: { height: 8, borderRadius: 4, backgroundColor: color.line, overflow: "hidden" },
  fill: { height: 8, backgroundColor: color.violet },
});
