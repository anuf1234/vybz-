import { RELEASE_KINDS, type ReleaseKind, type ReleaseView } from "@vybz/core";
import { Link, Stack, useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Chips } from "@/components/chips";
import { DropCard } from "@/components/drop-card";
import { color, space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading, Segmented } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

type Range = "today" | "week" | "following";
const KIND_OPTIONS = RELEASE_KINDS.map((k) => ({ value: k.key, label: k.plural }));

/** Daily Drops: new singles, EPs, albums and mixtapes. VYBZ links out to listen. */
export default function Drops() {
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const [range, setRange] = useState<Range>("today");
  const [kind, setKind] = useState<ReleaseKind | null>(null);
  const list = useResource(() => api.drops(range, kind), [range, kind, signedIn]);
  const [more, setMore] = useState<{ items: ReleaseView[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const items = [...(list.data?.items ?? []), ...(more?.items ?? [])];
  const cursor = more ? more.cursor : (list.data?.nextCursor ?? null);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.drops(range, kind, cursor);
      setMore({ items: [...(more?.items ?? []), ...page.items], cursor: page.nextCursor });
    } finally {
      setLoadingMore(false);
    }
  };
  const reset = () => setMore(null);

  return (
    <>
      <Stack.Screen options={{ title: "Daily Drops" }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
        refreshControl={<RefreshControl tintColor={color.violet} refreshing={list.refreshing} onRefresh={() => (reset(), void list.reload())} />}
      >
        <View style={{ gap: space.xs }}>
          <Text style={[type.display, { fontSize: 30 }]}>DAILY DROPS</Text>
          <Text style={type.small}>New singles, EPs, albums and mixtapes, every day. 🔥 what you're playing, follow artists, and start a war.</Text>
        </View>
        <Segmented
          value={range}
          onChange={(v) => (reset(), setRange(v))}
          options={[
            { value: "today", label: "Today" },
            { value: "week", label: "This week" },
            { value: "following", label: "Following" },
          ]}
        />
        <Chips value={kind} options={KIND_OPTIONS} onChange={(v) => (reset(), setKind(v))} anyLabel="All" />
        {signedIn ? (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button title="📼 Add a mixtape" kind="secondary" style={{ flex: 1 }} onPress={() => router.push("/drops/submit")} />
            <Button title="🎤 Artists" kind="secondary" style={{ flex: 1 }} onPress={() => router.push("/drops/artists")} />
          </View>
        ) : (
          <Link href="/sign-in" asChild>
            <Button title="Sign in to 🔥 drops and follow artists" />
          </Link>
        )}

        {list.error ? <ErrorBanner message={list.error.message} onRetry={() => void list.reload()} /> : null}
        {list.loading && !list.data ? <Loading /> : null}
        {items.map((d) => (
          <DropCard key={d.id} drop={d} signedIn={signedIn} />
        ))}
        {list.data && !items.length ? (
          range === "following" ? (
            <EmptyState title="Nothing from your artists yet" body="Follow artists and their new music shows up here (and we'll tell you when they drop)." action={signedIn ? <Button title="Find artists" onPress={() => router.push("/drops/artists")} /> : undefined} />
          ) : (
            <EmptyState title="No drops here yet" body="New music lands every morning. Check back soon, or share a mixtape." />
          )
        ) : null}
        {cursor ? <Button title={loadingMore ? "Loading…" : "Load more"} kind="secondary" onPress={() => void loadMore()} /> : null}
      </ScrollView>
    </>
  );
}
