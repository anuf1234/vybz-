import { Ionicons } from "@expo/vector-icons";
import type { PostView } from "@vybz/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { FollowButton } from "@/components/follow-button";
import { PostCard } from "@/components/post-card";
import { usePreviewPlayer } from "@/components/preview-player";
import { ProfileBody } from "@/components/profile-body";
import { color, space } from "@/components/theme";
import { Button, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useNow, useResource } from "@/lib/use-resource";

export default function UserProfile() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const prof = useResource(() => api.profile(handle), [handle]);
  const posts = useResource(() => api.feed({ handle }), [handle]);
  const preview = usePreviewPlayer();
  const now = useNow(30_000);
  const [error, setError] = useState<string | null>(null);
  const rel = prof.data?.social.viewer ?? null;

  const message = async () => {
    try {
      const { id } = await api.openConversation(handle);
      router.push({ pathname: "/messages/[id]", params: { id } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't open messages.");
    }
  };

  const more = () => {
    if (!rel) return;
    const toggleBlock = () =>
      void (rel.blocked ? api.unblock(handle) : api.block(handle)).then(
        () => Promise.all([prof.reload(), posts.reload()]),
        (err) => setError(err instanceof ApiRequestError ? err.message : "That didn't work."),
      );
    const confirmBlock = () =>
      rel.blocked || Platform.OS === "web"
        ? toggleBlock()
        : Alert.alert(`Block @${handle}?`, "You won't see each other's posts or comments, and neither of you can follow or message the other. They aren't told.", [
            { text: "Cancel", style: "cancel" },
            { text: "Block", style: "destructive", onPress: toggleBlock },
          ]);
    const report = () =>
      void api.report({ subjectType: "USER", subjectId: prof.data!.user.id, reason: "Reported from profile" }).then(
        () => Alert.alert("Thanks", "A moderator will take a look."),
        (err) => setError(err instanceof ApiRequestError ? err.message : "Couldn't send report."),
      );
    const options = [rel.blocked ? `Unblock @${handle}` : `Block @${handle}`, "Report", "Cancel"];
    if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 2, destructiveButtonIndex: 0 }, (i) => (i === 0 ? confirmBlock() : i === 1 ? report() : undefined));
    else if (Platform.OS === "web") confirmBlock();
    else Alert.alert(`@${handle}`, undefined, [{ text: options[0]!, style: "destructive", onPress: confirmBlock }, { text: "Report", onPress: report }, { text: "Cancel", style: "cancel" }]);
  };

  const removePost = (p: PostView) => posts.data && posts.setData({ ...posts.data, items: posts.data.items.filter((x) => x.id !== p.id) });

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
      <Stack.Screen
        options={{
          title: `@${handle}`,
          headerRight: rel
            ? () => (
                <Pressable onPress={more} hitSlop={10} accessibilityRole="button" accessibilityLabel="Block or report">
                  <Ionicons name="ellipsis-horizontal" size={22} color={color.text} />
                </Pressable>
              )
            : undefined,
        }}
      />
      {prof.error ? <ErrorBanner message={prof.error.message} onRetry={() => void prof.reload()} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {prof.data ? (
        <ProfileBody
          profile={prof.data}
          now={now}
          actions={
            rel && !rel.blocked ? (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <FollowButton key={String(rel.follows)} handle={handle} following={rel.follows} onChange={() => void prof.reload()} />
                </View>
                {rel.canMessage ? <Button title="Message" kind="secondary" style={{ flex: 1 }} onPress={() => void message()} /> : null}
              </View>
            ) : rel?.blocked ? (
              <Button title={`Unblock @${handle}`} kind="secondary" onPress={more} />
            ) : null
          }
        />
      ) : prof.loading ? (
        <Loading />
      ) : null}
      {posts.data?.items.length ? <SectionTitle>Posts</SectionTitle> : null}
      {posts.data?.items.map((p) => (
        <PostCard key={p.id} post={p} now={now} preview={preview} onDeleted={() => removePost(p)} />
      ))}
    </ScrollView>
  );
}
