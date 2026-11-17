import type { ShopItemView, ShopResponse } from "@vybz/core";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, Button, Card, EmptyState, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

const BLOCKED: Record<NonNullable<ShopItemView["blockedReason"]>, (i: ShopItemView, s: ShopResponse) => string> = {
  NOT_ENOUGH_COINS: (i, s) => `${i.price - s.coins} more coins`,
  OWNED: () => "Owned",
  MAX_HELD: (_i, s) => `Holding ${s.maxStreakFreezes} (max)`,
  LEVEL_TOO_LOW: (i) => `Level ${i.minLevel}+`,
};

/** Spend coins: streak freezes and profile frames. Coins are earned, never sold. */
export default function Shop() {
  const session = useSession();
  const signedIn = Boolean(session.data);
  const res = useResource(signedIn ? () => api.shop() : null, [signedIn]);
  const [state, setState] = useState<ShopResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = useResource(signedIn ? () => api.me() : null, [signedIn]);
  const s = state ?? res.data;

  if (session.isPending) return <Loading />;
  if (!signedIn) return <EmptyState title="Sign in to use the shop" body="Earn coins by battling, voting and claiming your daily reward." />;
  if (!s) return res.error ? <ErrorBanner message={res.error.message} onRetry={() => void res.reload()} /> : <Loading />;

  const run = async (key: string, fn: () => Promise<ShopResponse>) => {
    setBusy(key);
    setError(null);
    try {
      setState(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const freeze = s.items.find((i) => i.kind === "STREAK_FREEZE");
  const frames = s.items.filter((i) => i.kind === "FRAME");
  const name = me.data?.displayName ?? "You";

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
      refreshControl={
        <RefreshControl
          tintColor={color.violet}
          refreshing={res.refreshing}
          onRefresh={() => {
            setState(null);
            void res.reload();
          }}
        />
      }
    >
      <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View>
          <Text style={type.label}>Your coins</Text>
          <Text style={[type.display, { fontSize: 30 }]}>🪙 {s.coins}</Text>
        </View>
        <Text style={type.small}>Level {s.level}</Text>
      </Card>
      {error ? <Text style={[type.small, { color: color.danger, textAlign: "center" }]}>{error}</Text> : null}

      {freeze ? (
        <>
          <SectionTitle>Protect your streak</SectionTitle>
          <Card style={{ gap: space.sm }}>
            <View style={styles.head}>
              <Text style={{ fontSize: 30 }}>{freeze.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={type.heading}>{freeze.title}</Text>
                <Text style={type.small}>{freeze.description}</Text>
              </View>
            </View>
            <Text style={type.small}>
              Holding {s.streakFreezes} of {s.maxStreakFreezes}
            </Text>
            <BuyButton item={freeze} s={s} busy={busy === freeze.key} onPress={() => void run(freeze.key, () => api.buy(freeze.key))} />
          </Card>
        </>
      ) : null}

      <SectionTitle>Profile frames</SectionTitle>
      <Text style={type.small}>A ring around your avatar on your profile, posts and leaderboards.</Text>
      <View style={styles.grid}>
        {frames.map((f) => (
          <Card key={f.key} style={styles.frame}>
            <Avatar name={name} image={me.data?.image} size={64} ring={f.color} />
            <Text style={[type.body, { fontWeight: "800" }]}>{f.title}</Text>
            {f.owned ? (
              f.equipped ? (
                <Button title="Wearing" kind="ghost" onPress={() => void run(f.key, () => api.equipFrame(null))} loading={busy === f.key} />
              ) : (
                <Button title="Wear" kind="secondary" onPress={() => void run(f.key, () => api.equipFrame(f.key))} loading={busy === f.key} />
              )
            ) : (
              <BuyButton item={f} s={s} busy={busy === f.key} onPress={() => void run(f.key, () => api.buy(f.key))} />
            )}
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

function BuyButton({ item, s, busy, onPress }: { item: ShopItemView; s: ShopResponse; busy: boolean; onPress: () => void }) {
  const why = item.blockedReason ? BLOCKED[item.blockedReason](item, s) : null;
  return <Button title={why ?? `Buy · 🪙 ${item.price}`} kind={why ? "ghost" : "primary"} disabled={Boolean(why)} loading={busy} onPress={onPress} />;
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  frame: { width: "48%", alignItems: "center", gap: space.sm, borderRadius: radius.md },
});
