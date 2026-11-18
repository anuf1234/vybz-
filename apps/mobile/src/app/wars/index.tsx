import type { WarKind } from "@vybz/core";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Chips } from "@/components/chips";
import { color, space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading, Segmented, SectionTitle } from "@/components/ui";
import { Cover, WarCard } from "@/components/war-card";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

/** Album and Single Wars: live matchups, results, and what's charting to start one from. */
export default function Wars() {
  const router = useRouter();
  const session = useSession();
  const [status, setStatus] = useState<"OPEN" | "CLOSED">("OPEN");
  const [kind, setKind] = useState<WarKind | null>(null);
  const list = useResource(() => api.wars(status, kind), [status, kind]);
  const trending = useResource(() => api.trendingAlbums(), []);
  useFocusEffect(
    useCallback(() => {
      void list.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={list.refreshing} onRefresh={() => void list.reload()} />}>
      <View style={{ gap: space.xs }}>
        <Text style={[type.display, { fontSize: 30 }]}>ALBUM WARS</Text>
        <Text style={type.small}>Two releases, head to head: overall, best songs, production, lyrics, replay value, and track by track.</Text>
      </View>
      {session.data ? (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button title="💿 Start an album war" style={{ flex: 1 }} onPress={() => router.push({ pathname: "/wars/new", params: { kind: "ALBUM" } })} />
          <Button title="🎵 Single war" kind="secondary" onPress={() => router.push({ pathname: "/wars/new", params: { kind: "SINGLE" } })} />
        </View>
      ) : (
        <Link href="/sign-in" asChild>
          <Button title="Sign in to vote and start wars" />
        </Link>
      )}
      <Link href="/wars/rankings" asChild>
        <Button title="🏆 Best of the week, month and year" kind="secondary" />
      </Link>

      {trending.data?.items.length && session.data ? (
        <View style={{ gap: space.sm }}>
          <SectionTitle>Charting now: start a war</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
            {trending.data.items.slice(0, 15).map((a) => (
              <Pressable key={a.ref} onPress={() => router.push({ pathname: "/wars/new", params: { kind: "ALBUM", a: a.ref, aTitle: a.title } })} style={{ width: 110, gap: 4 }} accessibilityRole="button" accessibilityLabel={`Start a war with ${a.title}`}>
                <Cover url={a.artworkUrl} size={110} />
                <Text style={[type.small, { color: color.text, fontWeight: "700" }]} numberOfLines={1}>
                  {a.title}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {a.artistName}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { value: "OPEN", label: "Live wars" },
          { value: "CLOSED", label: "Results" },
        ]}
      />
      <Chips
        value={kind}
        onChange={setKind}
        anyLabel="All"
        options={[
          { value: "ALBUM" as WarKind, label: "Albums" },
          { value: "SINGLE" as WarKind, label: "Singles" },
        ]}
      />
      {list.error ? <ErrorBanner message={list.error.message} onRetry={() => void list.reload()} /> : null}
      {!list.data ? <Loading /> : null}
      {list.data && !list.data.items.length ? <EmptyState title={status === "OPEN" ? "No live wars" : "No results yet"} body="Start one: pick two albums everyone's arguing about." /> : null}
      {list.data?.items.map((w) => <WarCard key={w.id} w={w} />)}
    </ScrollView>
  );
}
