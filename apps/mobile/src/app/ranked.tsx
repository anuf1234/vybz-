import { Stack, useRouter } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, Button, Card, EmptyState, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { API_URL } from "@/lib/config";
import { shareMenu } from "@/lib/share-card";
import { useResource } from "@/lib/use-resource";

/** Ranked: your division and rating this season, and the ladder. */
export default function Ranked() {
  const router = useRouter();
  const session = useSession();
  const res = useResource(() => api.ranked(), [session.data?.user.id]);
  const r = res.data;
  const me = r?.me;
  return (
    <>
      <Stack.Screen options={{ title: "Ranked" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={res.refreshing} onRefresh={() => void res.reload()} />}>
        <View style={{ gap: space.xs }}>
          <Text style={[type.display, { fontSize: 30 }]}>RANKED</Text>
          <Text style={type.small}>Battle people near your rating. Win to climb from Bronze to Legend. Seasons reset every quarter{r ? ` (now ${r.season})` : ""}.</Text>
        </View>
        {res.error ? <ErrorBanner message={res.error.message} onRetry={() => void res.reload()} /> : null}
        {res.loading && !r ? <Loading /> : null}
        {me ? (
          <Card style={{ alignItems: "center", gap: space.xs, borderColor: color.violet }}>
            <Text style={{ fontSize: 48 }}>{me.icon}</Text>
            <Text style={type.title}>{me.placement ? "Placement" : me.divisionLabel}</Text>
            <Text style={[type.display, { fontSize: 32 }]}>{me.rating}</Text>
            <Text style={type.small}>
              {me.games ? `${me.wins}W · ${me.losses}L${me.draws ? ` · ${me.draws}D` : ""} · peak ${me.peak}` : "No ranked battles yet this season"}
            </Text>
            <Text style={type.small}>{me.placement ? `${Math.max(0, 5 - me.games)} placement battle${5 - me.games === 1 ? "" : "s"} left` : me.toNext !== null ? `${me.toNext} to the next division` : "Top division"}</Text>
          </Card>
        ) : null}
        {session.data ? <Button title="🏆 Play a ranked battle" onPress={() => router.push({ pathname: "/quick", params: { ranked: "1" } })} /> : null}
        {me && me.games && session.data ? (
          <Button
            title="Share my rank"
            kind="secondary"
            onPress={() => {
              if (r?.meHandle) shareMenu({ kind: "rank", id: r.meHandle, title: "Share your rank", message: `I'm ${me.divisionLabel} (${me.rating}) on VYBZ ranked. Think your taste is better?`, url: API_URL });
            }}
          />
        ) : null}
        {r ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, justifyContent: "center" }}>
            {r.divisions.map((d) => (
              <Text key={d.key} style={type.small}>
                {d.icon} {d.label} {d.min ? `${d.min}+` : ""}
              </Text>
            ))}
          </View>
        ) : null}
        <SectionTitle>Top this season</SectionTitle>
        {r && !r.top.length ? <EmptyState title="No ranked battles yet" body="Be the first on the ladder." /> : null}
        {r?.top.map((x) => (
          <View key={x.user.handle} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, borderRadius: radius.md, backgroundColor: color.surface1 }}>
            <Text style={[type.body, { width: 28, textAlign: "right", fontWeight: "800" }]}>{x.rank}</Text>
            <Avatar name={x.user.displayName} image={x.user.image} size={32} />
            <Text style={[type.body, { flex: 1 }]} numberOfLines={1} onPress={() => router.push({ pathname: "/user/[handle]", params: { handle: x.user.handle } })}>
              @{x.user.handle}
            </Text>
            <Text style={type.small}>{x.icon}</Text>
            <Text style={[type.body, { fontWeight: "800" }]}>{x.rating}</Text>
          </View>
        ))}
      </ScrollView>
    </>
  );
}
