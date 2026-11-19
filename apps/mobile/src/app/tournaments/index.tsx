import { Stack, useRouter } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** Song tournaments: brackets the community votes through over a week. */
export default function Tournaments() {
  const router = useRouter();
  const list = useResource(() => api.tournaments(), []);
  const me = useResource(() => api.me().catch(() => null), []);
  const staff = me.data?.role === "MODERATOR" || me.data?.role === "ADMIN";
  return (
    <>
      <Stack.Screen options={{ title: "Tournaments" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={list.refreshing} onRefresh={() => void list.reload()} />}>
        <View style={{ gap: space.xs }}>
          <Text style={[type.display, { fontSize: 30 }]}>TOURNAMENTS</Text>
          <Text style={type.small}>8 or 16 songs, head to head, round by round. Vote every matchup; the crowd crowns a champion.</Text>
        </View>
        {staff ? <Button title="+ New tournament" kind="secondary" onPress={() => router.push("/tournaments/new")} /> : null}
        {list.error ? <ErrorBanner message={list.error.message} onRetry={() => void list.reload()} /> : null}
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && !list.data.items.length ? <EmptyState title="No tournaments right now" body="The next bracket is coming soon." /> : null}
        {list.data?.items.map((t) => (
          <Pressable key={t.id} onPress={() => router.push({ pathname: "/tournaments/[id]", params: { id: t.id } })} style={({ pressed }) => [{ gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: t.status === "LIVE" ? color.violet : color.line, backgroundColor: color.surface1 }, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={t.title}>
            <View style={{ flexDirection: "row", gap: 4 }}>
              {(t.champion ? [t.champion.artworkUrl] : t.artwork).map((a, i) => (
                <Cover key={i} url={a} size={56} />
              ))}
            </View>
            <Text style={[type.body, { fontWeight: "800" }]}>{t.title}</Text>
            <Text style={type.small}>
              {t.champion ? `🏆 ${t.champion.title} by ${t.champion.artistName}` : `${t.roundName} · ends ${new Date(t.roundEndsAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`} · {t.size} songs · {t.voters} voters
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}
