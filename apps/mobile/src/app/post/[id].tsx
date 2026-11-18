import { frameColor } from "@vybz/core";
import type { CommentView, GifView } from "@vybz/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Gif, GifButton } from "@/components/gif";
import { PostCard } from "@/components/post-card";
import { usePreviewPlayer } from "@/components/preview-player";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, ErrorBanner, Loading } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { ago } from "@/lib/time";
import { useNow, useResource } from "@/lib/use-resource";

/** A post and its comments. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const detail = useResource(() => api.post(id), [id, signedIn], { pollMs: 15_000 });
  const preview = usePreviewPlayer();
  const now = useNow(30_000);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const d = detail.data;
  if (!d) {
    return detail.error ? (
      <View style={{ padding: space.lg }}>
        <ErrorBanner message={detail.error.status === 404 ? "This post isn't available." : detail.error.message} onRetry={() => void detail.reload()} />
      </View>
    ) : (
      <Loading />
    );
  }

  const send = async (gif?: GifView) => {
    setSending(true);
    setError(null);
    try {
      const c = await api.comment(id, gif ? text.trim() : text, gif);
      setText("");
      detail.setData({ post: { ...d.post, comments: d.post.comments + 1 }, comments: [...d.comments, c] });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't post that comment.");
    } finally {
      setSending(false);
    }
  };

  const toggleLike = (c: CommentView) => {
    const next = !c.liked;
    const patch = (fn: (x: CommentView) => CommentView) => detail.setData({ ...d, comments: d.comments.map((x) => (x.id === c.id ? fn(x) : x)) });
    patch((x) => ({ ...x, liked: next, likes: x.likes + (next ? 1 : -1) }));
    void api.likeComment(c.id, next).then(
      (r) => patch((x) => ({ ...x, ...r })),
      (err) => {
        patch((x) => ({ ...x, liked: c.liked, likes: c.likes }));
        setError(err instanceof ApiRequestError ? err.message : "That didn't work.");
      },
    );
  };

  const commentActions = (c: CommentView) => {
    const remove = () =>
      void api.deleteComment(c.id).then(
        () => detail.setData({ post: { ...d.post, comments: Math.max(0, d.post.comments - 1) }, comments: d.comments.filter((x) => x.id !== c.id) }),
        (err) => setError(err instanceof ApiRequestError ? err.message : "Couldn't delete it."),
      );
    const report = () =>
      void api.report({ subjectType: "COMMENT", subjectId: c.id, reason: "Reported from comments" }).then(
        () => Alert.alert("Thanks", "A moderator will take a look."),
        (err) => setError(err instanceof ApiRequestError ? err.message : "Couldn't send report."),
      );
    if (Platform.OS === "web") return c.canDelete ? remove() : report();
    Alert.alert("Comment", undefined, [
      ...(c.canDelete ? [{ text: "Delete", style: "destructive" as const, onPress: remove }] : []),
      ...(signedIn && c.author.id !== session.data?.user.id ? [{ text: "Report", style: "destructive" as const, onPress: report }] : []),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <FlatList
        data={d.comments}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <PostCard post={d.post} now={now} preview={preview} linkToDetail={false} onChanged={(p) => detail.setData({ ...d, post: p })} onDeleted={() => router.back()} />
            <Text style={type.label}>{d.comments.length ? `Comments · ${d.comments.length}` : "No comments yet"}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onLongPress={() => commentActions(item)} style={styles.comment} accessibilityHint="Long press for options">
            <Pressable onPress={() => router.push({ pathname: "/user/[handle]", params: { handle: item.author.handle } })} accessibilityRole="link" accessibilityLabel={`@${item.author.handle}`}>
              <Avatar name={item.author.displayName} image={item.author.image} size={30} ring={frameColor(item.author.frame)} />
            </Pressable>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.small}>
                <Text style={{ fontWeight: "700", color: color.text }}>@{item.author.handle}</Text> · {ago(item.createdAt, now)}
              </Text>
              {item.body ? <Text style={type.body}>{item.body}</Text> : null}
              {item.gif ? <Gif gif={item.gif} maxWidth={220} /> : null}
              <View style={{ flexDirection: "row", gap: space.md, alignItems: "center", marginTop: 2 }}>
                {signedIn ? (
                  <Pressable onPress={() => toggleLike(item)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${item.liked ? "Unlike" : "Like"} comment, ${item.likes} likes`}>
                    <Text style={[type.small, { color: item.liked ? color.danger : color.muted, fontWeight: "700" }]}>
                      {item.liked ? "♥" : "♡"}
                      {item.likes ? ` ${item.likes}` : " Like"}
                    </Text>
                  </Pressable>
                ) : item.likes ? (
                  <Text style={type.small}>♥ {item.likes}</Text>
                ) : null}
              </View>
            </View>
            {item.canDelete || signedIn ? (
              <Pressable onPress={() => commentActions(item)} hitSlop={8} accessibilityRole="button" accessibilityLabel={item.canDelete ? "Delete comment" : "Report comment"}>
                <Text style={[type.small, { fontSize: 11 }]}>{item.canDelete ? "Delete" : "Report"}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        )}
      />
      {error ? (
        <View style={{ paddingHorizontal: space.lg }}>
          <ErrorBanner message={error} />
        </View>
      ) : null}
      {signedIn ? (
        <View style={styles.inputRow}>
          <GifButton onPick={(g) => void send(g)} />
          <TextInput value={text} onChangeText={setText} placeholder="Add a comment" placeholderTextColor={color.lose} maxLength={500} style={styles.input} accessibilityLabel="Comment" multiline />
          <Pressable onPress={() => void send()} disabled={!text.trim() || sending} style={[styles.send, (!text.trim() || sending) && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Send comment">
            <Text style={{ color: "#fff", fontWeight: "700" }}>Send</Text>
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  comment: { flexDirection: "row", gap: space.sm, alignItems: "flex-start", paddingVertical: space.xs },
  inputRow: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, backgroundColor: color.ink },
  input: { flex: 1, minHeight: 42, maxHeight: 120, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, color: color.text, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 16 },
  send: { backgroundColor: color.violet, borderRadius: radius.md, paddingHorizontal: space.lg, justifyContent: "center" },
});
