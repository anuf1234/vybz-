import type { PeopleSuggestion, PostView } from "@vybz/core";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { FollowButton } from "@/components/follow-button";
import { PostCard } from "@/components/post-card";
import { usePreviewPlayer } from "@/components/preview-player";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, Button, EmptyState, ErrorBanner, Loading, SectionTitle, Segmented } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useNow, useResource } from "@/lib/use-resource";

type Kind = "following" | "for_you";

export default function Feed() {
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const [kind, setKind] = useState<Kind>("following");
  const active: Kind = signedIn ? kind : "for_you";
  const first = useResource(() => api.feed(active), [active, signedIn]);
  const people = useResource(signedIn && active === "following" ? () => api.peopleSuggestions() : null, [signedIn, active]);
  const [older, setOlder] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = usePreviewPlayer();
  const now = useNow(30_000);

  useFocusEffect(
    useCallback(() => {
      void first.reload();
      setOlder([]);
      setCursor(undefined);
      return preview.stop;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]),
  );

  const items = [...(first.data?.items ?? []), ...older.filter((o) => !(first.data?.items ?? []).some((f) => f.id === o.id))];
  const next = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor;

  const loadMore = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.feed(active, next);
      setOlder((o) => [...o, ...res.items]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  };

  const replace = (p: PostView) => {
    if (first.data) first.setData({ ...first.data, items: first.data.items.map((x) => (x.id === p.id ? p : x)) });
    setOlder((o) => o.map((x) => (x.id === p.id ? p : x)));
  };
  const remove = (id: string) => {
    if (first.data) first.setData({ ...first.data, items: first.data.items.filter((x) => x.id !== id) });
    setOlder((o) => o.filter((x) => x.id !== id));
  };

  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
      refreshControl={
        <RefreshControl
          tintColor={color.violet}
          refreshing={first.refreshing}
          onRefresh={() => {
            setOlder([]);
            setCursor(undefined);
            void Promise.all([first.reload(), people.reload()]);
          }}
        />
      }
      onEndReachedThreshold={0.6}
      onEndReached={() => void loadMore()}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          {signedIn ? (
            <>
              <Pressable onPress={() => router.push("/post/new")} style={styles.composer} accessibilityRole="button" accessibilityLabel="Write a post">
                <Text style={type.small}>Share a song, a playlist, or a hot take…</Text>
              </Pressable>
              <Segmented
                value={kind}
                onChange={setKind}
                options={[
                  { value: "following", label: "Following" },
                  { value: "for_you", label: "For you" },
                ]}
              />
            </>
          ) : (
            <Link href="/sign-in" asChild>
              <Button title="Sign in to post and follow people" />
            </Link>
          )}
          {error ? <ErrorBanner message={error} /> : null}
          {first.error ? <ErrorBanner message={first.error.message} onRetry={() => void first.reload()} /> : null}
          {people.data?.items.length ? <People items={people.data.items} /> : null}
        </View>
      }
      ListEmptyComponent={
        first.loading && !first.data ? (
          <Loading />
        ) : active === "following" ? (
          <EmptyState title="Nothing here yet" body="Follow people to see their posts, or check For you." />
        ) : (
          <EmptyState title="No posts yet" body="Be the first to share something." />
        )
      }
      ListFooterComponent={loadingMore ? <ActivityIndicator color={color.violet} style={{ marginVertical: space.lg }} /> : undefined}
      renderItem={({ item }) => <PostCard post={item} now={now} preview={preview} onChanged={replace} onDeleted={() => remove(item.id)} />}
    />
  );
}

function People({ items }: { items: PeopleSuggestion[] }) {
  const router = useRouter();
  return (
    <View style={{ gap: space.sm }}>
      <SectionTitle>People to follow</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {items.map((p) => (
          <View key={p.id} style={styles.person}>
            <Pressable onPress={() => router.push({ pathname: "/user/[handle]", params: { handle: p.handle } })} style={{ alignItems: "center", gap: 4 }} accessibilityRole="link" accessibilityLabel={`@${p.handle}`}>
              <Avatar name={p.displayName} image={p.image} size={52} />
              <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
                @{p.handle}
              </Text>
              <Text style={[type.small, { fontSize: 11 }]}>{p.reason}</Text>
            </Pressable>
            <FollowButton handle={p.handle} following={false} compact />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, padding: space.md, minHeight: 50, justifyContent: "center" },
  person: { width: 140, padding: space.sm, gap: space.sm, alignItems: "center", backgroundColor: color.surface1, borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
});
