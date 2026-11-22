import { LEAGUE, LEAGUES } from "@vybz/core";
import { Link, useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, Button, Card, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { API_URL } from "@/lib/config";
import { shareMenu } from "@/lib/share-card";
import { useNow, useResource } from "@/lib/use-resource";

function left(endsAt: string, now: number): string {
  const ms = Math.max(0, new Date(endsAt).getTime() - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

/**
 * Weekly leagues: your group, ranked by XP earned this week. The top move up
 * a league on Monday, the bottom move down. Plus your genre ranks this month
 * and your ranked season badges, each shareable.
 */
export default function Leagues() {
  const router = useRouter();
  const session = useSession();
  const league = useResource(session.data ? () => api.leagues() : null, [Boolean(session.data)], { pollMs: 60_000 });
  const genres = useResource(session.data ? () => api.genreRanks() : null, [Boolean(session.data)]);
  const now = useNow(60_000);

  if (!session.data) return <EmptyState title="Sign in for leagues" body="Earn XP each week to climb from Opening Act to Diamond Record." action={<Link href="/sign-in" asChild><Button title="Sign in" /></Link>} />;
  const v = league.data;
  if (!v) return league.error ? <View style={{ padding: space.lg }}><ErrorBanner message={league.error.message} onRetry={() => void league.reload()} /></View> : <Loading />;
  const me = v.standings?.find((s) => s.me);
  const handle = me?.user.handle ?? null;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={league.refreshing} onRefresh={() => void Promise.all([league.reload(), genres.reload()])} />}
    >
      <Card style={{ alignItems: "center", gap: space.xs, borderColor: color.violet }}>
        <Text style={{ fontSize: 48 }}>{v.league.icon}</Text>
        <Text style={type.title}>{v.league.label} league</Text>
        <Text style={type.small}>Week ends in {left(v.endsAt, now)} · top {LEAGUE.promote} move up, bottom {LEAGUE.demote} move down</Text>
        <View style={styles.ladder}>
          {LEAGUES.map((l, i) => (
            <Text key={l.key} style={[styles.rung, i === v.tier && styles.rungOn]} accessibilityLabel={`${l.label}${i === v.tier ? ", your league" : ""}`}>
              {l.icon}
            </Text>
          ))}
        </View>
      </Card>

      {v.last ? (
        <Text style={[type.body, { textAlign: "center" }]}>
          Last week: #{v.last.rank} in {LEAGUES[v.last.tier]!.label}
          {v.last.outcome === "PROMOTED" ? " · moved up 🎉" : v.last.outcome === "DEMOTED" ? " · moved down" : " · held on"}
        </Text>
      ) : null}

      {v.standings ? (
        <View style={{ gap: space.xs }}>
          <Text style={type.label}>YOUR GROUP · {v.standings.length} PLAYERS</Text>
          <View style={styles.list}>
            {v.standings.map((s, i) => (
              <View key={s.user.id} style={[styles.row, i > 0 && styles.rowLine, s.me && { backgroundColor: color.plum }]} accessibilityLabel={`${s.rank}. @${s.user.handle}, ${s.xp} XP${s.zone === "UP" ? ", promotion zone" : s.zone === "DOWN" ? ", relegation zone" : ""}`}>
                <Text style={[styles.rank, { color: s.zone === "UP" ? color.live : s.zone === "DOWN" ? color.danger : color.muted }]}>{s.rank}</Text>
                <Avatar name={s.user.displayName} image={s.user.image} size={32} />
                <Text style={[type.body, { flex: 1, fontWeight: s.me ? "800" : "600" }]} numberOfLines={1} onPress={() => router.push({ pathname: "/user/[handle]", params: { handle: s.user.handle } })}>
                  @{s.user.handle}
                </Text>
                <Text style={[type.body, { fontWeight: "800", fontVariant: ["tabular-nums"] }]}>{s.xp} XP</Text>
              </View>
            ))}
          </View>
          <Text style={type.small}>Green: moving up. Red: moving down. Ties go to whoever joined the group first.</Text>
        </View>
      ) : (
        <Card style={{ gap: space.sm }}>
          <Text style={type.heading}>Earn XP to join this week's group</Text>
          <Text style={type.small}>Battles, votes, trivia and posts all earn XP. Your first XP of the week puts you in a group of up to {LEAGUE.groupSize} players.</Text>
          <Button title="Start a quick battle" onPress={() => router.push("/quick")} />
        </Card>
      )}

      {handle ? (
        <Button
          title="Share my league"
          kind="secondary"
          onPress={() => shareMenu({ kind: "league", id: handle, title: "Share your league", message: `I'm #${me!.rank} in the ${v.league.label} league on VYBZ this week. Come battle me.`, url: API_URL })}
        />
      ) : null}

      {genres.data?.items.length ? (
        <View style={{ gap: space.sm }}>
          <Text style={type.label}>MY GENRE RANKS · THIS MONTH</Text>
          <Card style={{ gap: space.sm }}>
            {genres.data.items.slice(0, 5).map((g) => (
              <View key={g.genre} style={{ flexDirection: "row", alignItems: "baseline", gap: space.md }}>
                <Text style={[type.title, { width: 64, color: g.rank <= 3 ? color.violetSoft : color.text }]}>#{g.rank}</Text>
                <Text style={[type.body, { flex: 1, fontWeight: "700" }]}>{g.label}</Text>
                <Text style={type.small}>{g.wins} win{g.wins === 1 ? "" : "s"}</Text>
              </View>
            ))}
          </Card>
          {session.data && genres.data.items.length ? (
            <Button
              title="Share my genre ranks"
              kind="secondary"
              onPress={() =>
                void api.me().then((m) =>
                  shareMenu({ kind: "genres", id: m.handle, title: "Share your genre ranks", message: `I'm #${genres.data!.items[0]!.rank} in ${genres.data!.items[0]!.label} on VYBZ this month. Think you know it better?`, url: API_URL }),
                )
              }
            />
          ) : null}
        </View>
      ) : null}

      {v.badges.length ? (
        <View style={{ gap: space.sm }}>
          <Text style={type.label}>RANKED SEASONS</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {v.badges.map((b) => (
              <View key={b.season} style={styles.badge}>
                <Text style={{ fontSize: 22 }}>{b.icon}</Text>
                <Text style={[type.small, { color: color.text, fontWeight: "700" }]}>{b.label}</Text>
                <Text style={type.small}>{b.season}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <Button title="🏆 Play ranked" kind="ghost" onPress={() => router.push("/ranked")} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ladder: { flexDirection: "row", gap: 6, marginTop: space.sm },
  rung: { fontSize: 20, opacity: 0.35 },
  rungOn: { opacity: 1, transform: [{ scale: 1.3 }] },
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md },
  rowLine: { borderTopWidth: 1, borderTopColor: color.line },
  rank: { width: 24, textAlign: "right", fontWeight: "800" },
  badge: { alignItems: "center", gap: 2, padding: space.sm, minWidth: 84, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
});
