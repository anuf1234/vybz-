import { type ChatMessageView, type GifView, type LiveView, REACTIONS, type Reaction } from "@vybz/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ApiRequestError, api } from "@/lib/api";
import { Gif, GifButton } from "./gif";
import { color, radius, space, type } from "./theme";

const POLL_MS = 3_000;
const HEARTBEAT_MS = 15_000;

/**
 * Viewer count, reactions and chat for a battle. Polls while mounted and sends
 * a presence heartbeat so the viewer count stays honest.
 */
export function LiveStrip({ battleId, canChat, isModerator, signedIn }: { battleId: string; canChat: boolean; isModerator: boolean; signedIn: boolean }) {
  const [live, setLive] = useState<LiveView | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [burst, setBurst] = useState<Reaction | null>(null);
  const lastId = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const v = await api.live(battleId, lastId.current);
      setLive(v);
      if (v.messages.length) {
        lastId.current = v.messages[v.messages.length - 1]!.id;
        setMessages((prev) => [...prev, ...v.messages.filter((m) => !prev.some((p) => p.id === m.id))].slice(-100));
      }
    } catch {
      // Live data is best-effort; the battle itself still works.
    }
  }, [battleId]);

  useEffect(() => {
    void poll();
    void api.presence(battleId).catch(() => undefined);
    const p = setInterval(() => void poll(), POLL_MS);
    const h = setInterval(() => void api.presence(battleId).catch(() => undefined), HEARTBEAT_MS);
    return () => {
      clearInterval(p);
      clearInterval(h);
    };
  }, [battleId, poll]);

  async function send(gif?: GifView) {
    const body = draft.trim();
    if (!body && !gif) return;
    setError(null);
    try {
      const m = await api.chat(battleId, gif ? "" : body, gif);
      if (!gif) setDraft("");
      setOpen(true);
      lastId.current = m.id;
      setMessages((prev) => [...prev, m]);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't send.");
    }
  }

  async function reactWith(emoji: Reaction) {
    setBurst(emoji);
    setTimeout(() => setBurst(null), 600);
    try {
      await api.react(battleId, emoji);
      void poll();
    } catch {
      // ignore rate limits silently; the burst still shows
    }
  }

  async function toggleLike(m: ChatMessageView) {
    const next = !m.liked;
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, liked: next, likes: x.likes + (next ? 1 : -1) } : x)));
    try {
      const r = await api.likeChat(battleId, m.id, next);
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...r } : x)));
    } catch (err) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, liked: m.liked, likes: m.likes } : x)));
      setError(err instanceof ApiRequestError ? err.message : "That didn't work.");
    }
  }

  async function act(m: ChatMessageView, what: "report" | "hide") {
    setSelected(null);
    try {
      if (what === "hide") {
        await api.hideMessage(m.id);
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, hidden: true } : x)));
      } else {
        await api.report({
          subjectType: "CHAT_MESSAGE",
          subjectId: m.id,
          reason: "Reported from battle chat",
        });
        setError("Thanks. A moderator will take a look.");
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That didn't work.");
    }
  }

  const recentTotal = Object.values(live?.recentReactions ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const visible = messages.filter((m) => !m.hidden || isModerator);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.viewers} accessibilityLabel={`${live?.viewers ?? 0} watching now`}>
          <View style={styles.dot} />
          <Text style={[type.small, { color: color.text }]}>{live?.viewers ?? 0} watching</Text>
        </View>
        {recentTotal ? <Text style={type.small}>{recentTotal} reactions this minute</Text> : null}
      </View>

      <View style={styles.reactions} accessibilityRole="toolbar">
        {REACTIONS.map((r) => (
          <Pressable
            key={r}
            onPress={() => void reactWith(r)}
            accessibilityRole="button"
            accessibilityLabel={`React ${r}`}
            style={({ pressed }) => [styles.reaction, (pressed || burst === r) && styles.reactionOn]}
          >
            <Text style={{ fontSize: 20 }}>{r}</Text>
            {live?.reactionTotals[r] ? <Text style={styles.reactionCount}>{live.reactionTotals[r]}</Text> : null}
          </Pressable>
        ))}
        {canChat ? <GifButton compact onPick={(g) => void send(g)} /> : null}
      </View>

      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" style={styles.chatToggle}>
        <Text style={[type.body, { fontWeight: "700" }]}>Chat{visible.length ? ` · ${visible.length}` : ""}</Text>
        <Text style={type.small}>{open ? "Hide" : "Show"}</Text>
      </Pressable>

      {open ? (
        <View style={{ gap: space.sm }}>
          {visible.length === 0 ? <Text style={type.small}>No messages yet. Say something.</Text> : null}
          {visible.slice(-30).map((m) => (
            <View key={m.id}>
              <View style={styles.msgRow}>
                <Pressable style={{ flex: 1, gap: 4 }} onPress={() => setSelected(selected === m.id ? null : m.id)} accessibilityHint="Shows message actions">
                  <Text style={[type.body, m.hidden && { opacity: 0.4 }]}>
                    <Text style={{ fontWeight: "700", color: color.violetSoft }}>@{m.user.handle} </Text>
                    {m.body}
                    {m.hidden ? " (hidden)" : ""}
                  </Text>
                  {m.gif && !m.hidden ? <Gif gif={m.gif} maxWidth={200} /> : null}
                </Pressable>
                {signedIn ? (
                  <Pressable
                    onPress={() => void toggleLike(m)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.liked ? "Unlike" : "Like"}, ${m.likes} likes`}
                    style={styles.like}
                  >
                    <Text
                      style={{
                        color: m.liked ? color.danger : color.muted,
                        fontSize: 14,
                      }}
                    >
                      {m.liked ? "♥" : "♡"}
                    </Text>
                    {m.likes ? <Text style={styles.reactionCount}>{m.likes}</Text> : null}
                  </Pressable>
                ) : m.likes ? (
                  <Text style={[styles.reactionCount, { paddingTop: 2 }]}>♥ {m.likes}</Text>
                ) : null}
              </View>
              {selected === m.id && signedIn ? (
                <View style={styles.msgActions}>
                  <Pressable onPress={() => void act(m, "report")} accessibilityRole="button">
                    <Text style={styles.msgAction}>Report</Text>
                  </Pressable>
                  {isModerator && !m.hidden ? (
                    <Pressable onPress={() => void act(m, "hide")} accessibilityRole="button">
                      <Text style={[styles.msgAction, { color: color.danger }]}>Hide</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
          {canChat ? (
            <View style={styles.inputRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Say something"
                placeholderTextColor={color.lose}
                maxLength={280}
                style={styles.input}
                onSubmitEditing={() => void send()}
                returnKeyType="send"
                accessibilityLabel="Chat message"
              />
              <GifButton onPick={(g) => void send(g)} />
              <Pressable onPress={() => void send()} accessibilityRole="button" style={styles.send}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>Send</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={type.small}>{signedIn ? "Chat is closed." : "Sign in to chat."}</Text>
          )}
        </View>
      ) : null}
      {error ? <Text style={type.small}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: color.surface1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.md,
    gap: space.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  viewers: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.live },
  reactions: { flexDirection: "row", justifyContent: "space-between" },
  reaction: {
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: radius.md,
  },
  reactionOn: { backgroundColor: color.surface3, transform: [{ scale: 1.15 }] },
  reactionCount: { color: color.muted, fontSize: 11, fontWeight: "700" },
  chatToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  msgRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  like: { alignItems: "center", minWidth: 24 },
  msgActions: {
    flexDirection: "row",
    gap: space.lg,
    paddingVertical: 4,
    paddingLeft: space.sm,
  },
  msgAction: { color: color.violetSoft, fontWeight: "700", fontSize: 13 },
  inputRow: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  input: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface2,
    color: color.text,
    paddingHorizontal: space.md,
  },
  send: {
    backgroundColor: color.violet,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 42,
    justifyContent: "center",
  },
});
