import type { BattleListItem } from "@vybz/core";
import { Link } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { BattleCard } from "@/components/battle-card";
import { DailyReward } from "@/components/daily-reward";
import { StartHere } from "@/components/start-here";
import { TodayCard } from "@/components/today-card";
import { color, space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useNow, useResource } from "@/lib/use-resource";
import { useState } from "react";

export default function Home() {
  const session = useSession();
  const signedIn = Boolean(session.data);
  const vote = useResource(() => api.battles("vote"), [signedIn], { pollMs: 20_000 });
  const feed = useResource(() => api.battles("home"), [signedIn], { pollMs: 30_000 });
  const featured = useResource(() => api.battles("featured"), [signedIn], { pollMs: 60_000 });
  const daily = useResource(() => api.battles("daily"), [signedIn], { pollMs: 60_000 });
  const now = useNow(1000);
  // While a new player is on the first-run path, Home stays focused on it.
  const [onboarding, setOnboarding] = useState(false);

  const today = daily.data?.items[0];
  const featuredItems = (featured.data?.items ?? []).filter((b) => b.id !== today?.id);
  const voteIds = new Set([...(vote.data?.items.map((b) => b.id) ?? []), ...featuredItems.map((b) => b.id), ...(today ? [today.id] : [])]);
  const rest = (feed.data?.items ?? []).filter((b) => !voteIds.has(b.id));
  const live = rest.filter((b) => b.status === "IN_PROGRESS");
  const done = rest.filter((b) => b.status === "COMPLETE");
  const open = rest.filter((b) => b.status === "OPEN_CHALLENGE");

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
      refreshControl={
        <RefreshControl
          tintColor={color.violet}
          refreshing={feed.refreshing}
          onRefresh={() => void Promise.all([feed.reload(), vote.reload(), featured.reload(), daily.reload()])}
        />
      }
    >
      <View style={{ gap: space.xs }}>
        <Text style={[type.display, { fontSize: 30 }]}>BATTLE YOUR TASTE.</Text>
        <Text style={type.small}>Pick tracks, face the crowd. Listen to every entry, then vote.</Text>
      </View>
      {!signedIn && !session.isPending ? (
        <Link href="/sign-up" asChild>
          <Button title="Join VYBZ" />
        </Link>
      ) : null}

      {signedIn ? <StartHere key={session.data?.user.id} onState={(o) => setOnboarding(!!o?.active)} /> : null}
      {signedIn && !onboarding ? (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Link href="/quick" asChild>
            <Button title="⚡ Quick battle" style={{ flex: 1 }} />
          </Link>
          <Link href="/trivia" asChild>
            <Button title="🧠 Daily trivia" kind="secondary" style={{ flex: 1 }} />
          </Link>
        </View>
      ) : null}
      {signedIn && !onboarding ? <TodayCard key={`today-${session.data?.user.id}`} /> : null}
      {!onboarding ? (
        <>
          {!signedIn ? (
            <Link href="/drops" asChild>
              <Button title="🆕 Daily Drops: new music today" kind="secondary" />
            </Link>
          ) : null}
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Link href="/dj" asChild>
              <Button title="🎧 DJ Vybz" kind="secondary" style={{ flex: 1 }} />
            </Link>
            <Link href="/party" asChild>
              <Button title="🎉 Party Mode" kind="secondary" style={{ flex: 1 }} />
            </Link>
          </View>
          <Link href="/wars" asChild>
            <Button title="💿 Album & Single Wars" kind="secondary" />
          </Link>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Link href="/ranked" asChild>
              <Button title="🏆 Ranked" kind="secondary" style={{ flex: 1 }} />
            </Link>
            <Link href="/tournaments" asChild>
              <Button title="🗂️ Tournaments" kind="secondary" style={{ flex: 1 }} />
            </Link>
          </View>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Link href="/verdict" asChild>
              <Button title="🆚 This or That" kind="secondary" style={{ flex: 1 }} />
            </Link>
            <Link href="/chart" asChild>
              <Button title="📊 VYBZ Chart" kind="secondary" style={{ flex: 1 }} />
            </Link>
          </View>
        </>
      ) : null}
      {signedIn && !onboarding ? <DailyReward key={session.data?.user.id} /> : null}

      {feed.error ? <ErrorBanner message={feed.error.message} onRetry={() => void feed.reload()} /> : null}
      {feed.loading && !feed.data ? <Loading /> : null}

      {today ? <List title="Today's battle" items={[today]} now={now} /> : null}
      <List title="Featured" items={featuredItems} now={now} />
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
