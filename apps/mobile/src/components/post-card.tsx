import { frameColor } from "@vybz/core";
import { Ionicons } from "@expo/vector-icons";
import type { PostView } from "@vybz/core";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ApiRequestError, api } from "@/lib/api";
import { ago } from "@/lib/time";
import { BattleCard } from "./battle-card";
import { PlaylistCard } from "./playlist-card";
import { SaveButton } from "./save-button";
import { SongRow } from "./song-row";
import { color, radius, space, type } from "./theme";
import { Avatar } from "./ui";

/**
 * A post: author, text, an optional song / playlist / battle, likes and
 * comments. `preview` comes from a shared preview player in the list.
 */
export function PostCard({
  post,
  now,
  preview,
  onChanged,
  onDeleted,
  linkToDetail = true,
}: {
  post: PostView;
  now: number;
  preview: { currentId: string | null; toggle: (hit: Extract<PostView["attachment"], { kind: "track" }>["track"]) => void };
  onChanged?: (p: PostView) => void;
  onDeleted?: () => void;
  linkToDetail?: boolean;
}) {
  const router = useRouter();
  const [p, setP] = useState(post);
  // Follow fresh data from the list (after a refresh or a comment).
  useEffect(() => setP(post), [post]);

  const toggleLike = async () => {
    if (!p.viewer) return router.push("/sign-in");
    const liked = !p.viewer.liked;
    const next = { ...p, likes: p.likes + (liked ? 1 : -1), viewer: { ...p.viewer, liked } };
    setP(next);
    onChanged?.(next);
    if (liked && Platform.OS !== "web") void Haptics.selectionAsync();
    try {
      await api.like(p.id, liked);
    } catch {
      setP(p);
      onChanged?.(p);
    }
  };

  const more = () => {
    const actions: { label: string; destructive?: boolean; run: () => void }[] = [];
    if (p.viewer?.canDelete) {
      actions.push({
        label: "Delete post",
        destructive: true,
        run: () =>
          void api.deletePost(p.id).then(
            () => onDeleted?.(),
            (err) => Alert.alert("Couldn't delete it", err instanceof ApiRequestError ? err.message : "Try again."),
          ),
      });
    }
    if (p.viewer && !p.viewer.canDelete) {
      actions.push({
        label: "Report post",
        destructive: true,
        run: () =>
          void api.report({ subjectType: "POST", subjectId: p.id, reason: "Reported from the feed" }).then(
            () => Alert.alert("Thanks", "A moderator will take a look."),
            (err) => Alert.alert("Couldn't send report", err instanceof ApiRequestError ? err.message : "Try again."),
          ),
      });
    }
    if (!actions.length) return;
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...actions.map((a) => a.label), "Cancel"], cancelButtonIndex: actions.length, destructiveButtonIndex: actions.findIndex((a) => a.destructive) },
        (i) => actions[i]?.run(),
      );
    } else if (Platform.OS === "web") {
      actions[0]!.run();
    } else {
      Alert.alert("Post", undefined, [...actions.map((a) => ({ text: a.label, style: a.destructive ? ("destructive" as const) : ("default" as const), onPress: a.run })), { text: "Cancel", style: "cancel" as const }]);
    }
  };

  const openDetail = () => (linkToDetail ? router.push({ pathname: "/post/[id]", params: { id: p.id } }) : undefined);
  const a = p.attachment;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pressable onPress={() => router.push({ pathname: "/user/[handle]", params: { handle: p.author.handle } })} style={styles.author} accessibilityRole="link" accessibilityLabel={`@${p.author.handle}'s profile`}>
          <Avatar name={p.author.displayName} image={p.author.image} size={36} ring={frameColor(p.author.frame)} />
          <View>
            <Text style={[type.body, { fontWeight: "700" }]}>{p.author.displayName}</Text>
            <Text style={type.small}>
              @{p.author.handle} · {ago(p.createdAt, now)}
            </Text>
          </View>
        </Pressable>
        {p.viewer ? (
          <Pressable onPress={more} hitSlop={10} accessibilityRole="button" accessibilityLabel={p.viewer.canDelete ? "Post options" : "Report or more"}>
            <Ionicons name="ellipsis-horizontal" size={18} color={color.muted} />
          </Pressable>
        ) : null}
      </View>

      <Pressable onPress={openDetail} disabled={!linkToDetail} accessibilityRole={linkToDetail ? "link" : undefined}>
        <Text style={[type.body, { lineHeight: 22 }]}>{p.body}</Text>
      </Pressable>

      {a?.kind === "track" ? (
        <SongRow hit={a.track} playing={preview.currentId === a.track.catalogId} onPreview={() => preview.toggle(a.track)} right={<SaveButton song={a.track} />} />
      ) : a?.kind === "playlist" ? (
        <PlaylistCard p={a.playlist} showOwner onPress={() => router.push({ pathname: "/playlist/[id]", params: { id: a.playlist.id } })} />
      ) : a?.kind === "battle" ? (
        <BattleCard battle={a.battle} now={now} />
      ) : null}

      <View style={styles.actions}>
        <Pressable onPress={() => void toggleLike()} style={styles.action} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: p.viewer?.liked ?? false }} accessibilityLabel={`${p.viewer?.liked ? "Unlike" : "Like"}, ${p.likes} likes`}>
          <Ionicons name={p.viewer?.liked ? "heart" : "heart-outline"} size={20} color={p.viewer?.liked ? color.live : color.muted} />
          <Text style={type.small}>{p.likes || ""}</Text>
        </Pressable>
        <Pressable onPress={openDetail} disabled={!linkToDetail} style={styles.action} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${p.comments} comments`}>
          <Ionicons name="chatbubble-outline" size={19} color={color.muted} />
          <Text style={type.small}>{p.comments || ""}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface1, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, padding: space.md, gap: space.md },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  author: { flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1 },
  actions: { flexDirection: "row", gap: space.xl },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 44 },
});
