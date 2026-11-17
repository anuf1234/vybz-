import type { DirectMessageView } from "@vybz/core";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { ErrorBanner, Loading } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** A conversation. Refreshes every few seconds while open. */
export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conv = useResource(() => api.conversation(id), [id], { pollMs: 4000 });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<DirectMessageView[]>([]);
  const list = useRef<FlatList<DirectMessageView>>(null);

  const c = conv.data;
  // Messages the server hasn't returned yet stay visible until it does.
  const messages = c ? [...c.messages, ...pending.filter((p) => !c.messages.some((m) => m.id === p.id))] : [];
  useEffect(() => {
    if (messages.length) setTimeout(() => list.current?.scrollToEnd({ animated: false }), 50);
  }, [messages.length]);

  if (!c) {
    return conv.error ? (
      <View style={{ padding: space.lg }}>
        <ErrorBanner message={conv.error.message} onRetry={() => void conv.reload()} />
      </View>
    ) : (
      <Loading />
    );
  }

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const m = await api.sendMessage(id, body);
      setText("");
      setPending((p) => [...p, m]);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't send that.");
    } finally {
      setSending(false);
    }
  };

  const report = (m: DirectMessageView) => {
    if (m.fromMe) return;
    const doIt = () =>
      void api.report({ subjectType: "DIRECT_MESSAGE", subjectId: m.id, reason: "Reported from messages" }).then(
        () => Alert.alert("Thanks", "A moderator will take a look."),
        (err) => setError(err instanceof ApiRequestError ? err.message : "Couldn't send report."),
      );
    if (Platform.OS === "web") return doIt();
    Alert.alert("Report this message?", "A moderator will review it.", [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: doIt },
    ]);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: `@${c.other.handle}` }} />
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListEmptyComponent={<Text style={[type.small, { textAlign: "center", marginTop: space.xl }]}>Say hi to @{c.other.handle}.</Text>}
        renderItem={({ item }) => (
          <Pressable onLongPress={() => report(item)} style={[styles.bubble, item.fromMe ? styles.mine : styles.theirs]} accessibilityLabel={`${item.fromMe ? "You" : `@${c.other.handle}`}: ${item.body}`} accessibilityHint={item.fromMe ? undefined : "Long press to report"}>
            <Text style={[type.body, item.fromMe && { color: "#fff" }]}>{item.body}</Text>
          </Pressable>
        )}
      />
      {error ? (
        <View style={{ paddingHorizontal: space.lg }}>
          <ErrorBanner message={error} />
        </View>
      ) : null}
      {c.canSend ? (
        <View style={styles.inputRow}>
          <TextInput value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={color.lose} maxLength={1000} style={styles.input} accessibilityLabel="Message" multiline />
          <Pressable onPress={() => void send()} disabled={!text.trim() || sending} style={[styles.send, (!text.trim() || sending) && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Send message">
            <Text style={{ color: "#fff", fontWeight: "700" }}>Send</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[type.small, { textAlign: "center", padding: space.lg }]}>
          {c.blockedReason === "BLOCKED" ? "You can't message this person." : "You can message people once one of you follows the other."}
        </Text>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: "80%", paddingHorizontal: space.md, paddingVertical: 10, borderRadius: radius.lg },
  mine: { alignSelf: "flex-end", backgroundColor: color.violet, borderBottomRightRadius: 4 },
  theirs: { alignSelf: "flex-start", backgroundColor: color.surface2, borderBottomLeftRadius: 4 },
  inputRow: { flexDirection: "row", gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, backgroundColor: color.ink },
  input: { flex: 1, minHeight: 42, maxHeight: 120, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, color: color.text, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 16 },
  send: { backgroundColor: color.violet, borderRadius: radius.md, paddingHorizontal: space.lg, justifyContent: "center" },
});
