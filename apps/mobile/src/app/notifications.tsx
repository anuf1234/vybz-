import type { NotificationType, NotificationView } from "@vybz/core";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { registerForPush } from "@/lib/push";
import { useResource } from "@/lib/use-resource";

const ICON: Record<NotificationType, string> = {
  CHALLENGED: "⚔️",
  INVITED: "✉️",
  COUNTERED: "↩️",
  CHALLENGE_ACCEPTED: "✅",
  PLAYER_JOINED: "➕",
  BATTLE_STARTED: "▶️",
  YOUR_PICK: "🎧",
  VOTING_OPEN: "🗳️",
  ROUND_RESULT: "🏁",
  BATTLE_RESULT: "🏆",
  NEW_FOLLOWER: "👤",
  POST_LIKED: "❤️",
  POST_COMMENT: "💬",
  NEW_MESSAGE: "✉️",
  ACHIEVEMENT_UNLOCKED: "🏅",
  LEVEL_UP: "⭐",
  STREAK_REMINDER: "🔥",
};

export default function NotificationsScreen() {
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const list = useResource(signedIn ? () => api.notifications() : null, [signedIn], { pollMs: 30_000 });

  useEffect(() => {
    if (signedIn) void registerForPush().catch(() => undefined);
  }, [signedIn]);

  if (!signedIn) return <EmptyState title="Sign in for notifications" body="Challenges, invites and results show up here." />;
  if (!list.data) return list.error ? <ErrorBanner message={list.error.message} onRetry={() => void list.reload()} /> : <Loading />;

  const open = async (n: NotificationView) => {
    if (!n.readAt) void api.markRead([n.id]).then(() => list.reload()).catch(() => undefined);
    if (n.link?.startsWith("/")) router.push(n.link as never);
    else if (n.battleId) router.push({ pathname: "/battle/[id]", params: { id: n.battleId } });
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={list.refreshing} onRefresh={() => void list.reload()} />}
    >
      {list.data.unread ? (
        <Button title={`Mark all ${list.data.unread} read`} kind="ghost" onPress={() => void api.markRead("all").then(() => list.reload())} />
      ) : null}
      {!list.data.items.length ? <EmptyState title="All quiet" body="Challenges, invites and results show up here." /> : null}
      {list.data.items.map((n) => (
        <Pressable key={n.id} onPress={() => void open(n)} accessibilityRole="button" style={[styles.row, !n.readAt && styles.unread]}>
          <Text style={{ fontSize: 20 }}>{ICON[n.type]}</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.body, { fontWeight: n.readAt ? "400" : "700" }]}>{n.title}</Text>
            <Text style={type.small}>{n.body}</Text>
            <Text style={[type.small, { fontSize: 11 }]}>{ago(n.createdAt)}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.line },
  unread: { borderColor: color.violet },
});
