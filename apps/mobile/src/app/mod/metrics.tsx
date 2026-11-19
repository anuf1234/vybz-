import type { MetricsResponse } from "@vybz/core";
import { Stack } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Card, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** Staff: the numbers that matter for growth (and for anyone looking to invest in or buy VYBZ). */
export default function Metrics() {
  const res = useResource(() => api.modMetrics(), []);
  const m = res.data;
  return (
    <>
      <Stack.Screen options={{ title: "Growth metrics" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={res.refreshing} onRefresh={() => void res.reload()} />}>
        {res.error ? <ErrorBanner message={res.error.message} onRetry={() => void res.reload()} /> : null}
        {res.loading && !m ? <Loading /> : null}
        {m ? <Body m={m} /> : null}
      </ScrollView>
    </>
  );
}

function Body({ m }: { m: MetricsResponse }) {
  const max = Math.max(1, ...m.daily.map((d) => d.dau));
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Stat label="Daily active" value={m.dau} />
        <Stat label="Weekly active" value={m.wau} />
        <Stat label="Monthly active" value={m.mau} />
        <Stat label="DAU / MAU" value={m.stickiness === null ? "–" : `${m.stickiness}%`} />
        <Stat label="People" value={m.users} />
        <Stat label="New this week" value={m.newUsers7d} />
      </View>

      <Card style={{ gap: space.sm }}>
        <SectionTitle>Daily active, last 30 days</SectionTitle>
        <View style={{ flexDirection: "row", alignItems: "flex-end", height: 110, gap: 2 }} accessibilityLabel={`Daily active people, last 30 days. Today ${m.dau}.`}>
          {m.daily.map((d) => (
            <View key={d.day} style={{ flex: 1, height: Math.max(2, (d.dau / max) * 100), backgroundColor: color.violet, borderRadius: 2 }} />
          ))}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={type.small}>{m.daily[0]?.day.slice(5)}</Text>
          <Text style={type.small}>Peak {max}</Text>
          <Text style={type.small}>{m.daily.at(-1)?.day.slice(5)}</Text>
        </View>
      </Card>

      <Card style={{ gap: space.sm }}>
        <SectionTitle>Retention by signup week</SectionTitle>
        <Text style={type.small}>Share of each week's new people who came back exactly 1, 7 and 30 days after joining.</Text>
        <TableRow cells={["Week of", "New", "Day 1", "Day 7", "Day 30"]} head />
        {m.retention.length ? m.retention.map((r) => <TableRow key={r.week} cells={[r.week.slice(5), String(r.size), fmt(r.d1), fmt(r.d7), fmt(r.d30)]} />) : <Text style={type.small}>No signups in the last 9 weeks.</Text>}
      </Card>

      <Card style={{ gap: space.sm }}>
        <SectionTitle>Last 7 days</SectionTitle>
        <TableRow cells={["Battles finished", String(m.week.battles)]} />
        <TableRow cells={["Battle votes", String(m.week.votes)]} />
        <TableRow cells={["War votes", String(m.week.warVotes)]} />
        <TableRow cells={["Trivia games", String(m.week.trivia)]} />
        <TableRow cells={["Drops fired up", String(m.week.fires)]} />
        <TableRow cells={["This or That picks", String(m.week.verdicts)]} />
        <TableRow cells={["Posts", String(m.week.posts)]} />
        <TableRow cells={["New drops", String(m.week.drops)]} />
        <TableRow cells={["Mixtapes waiting", String(m.week.pendingMixtapes)]} />
        <TableRow cells={["Actions per active person", String(m.week.perActiveUser)]} head />
      </Card>

      <Card style={{ gap: space.sm }}>
        <SectionTitle>Plays sent to streaming services</SectionTitle>
        <TableRow cells={["Service", "7 days", "30 days", "All time"]} head />
        {m.outbound.length ? m.outbound.map((o) => <TableRow key={o.service} cells={[label(o.service), String(o.week), String(o.month), String(o.total)]} />) : <Text style={type.small}>No taps out yet.</Text>}
      </Card>
      <Text style={type.small}>Days are UTC. As of {new Date(m.asOf).toLocaleString()}.</Text>
    </>
  );
}

const fmt = (v: number | null) => (v === null ? "–" : `${v}%`);
const label = (s: string) => ({ spotify: "Spotify", apple: "Apple Music", youtube: "YouTube" })[s] ?? s;

function Stat({ label: l, value }: { label: string; value: number | string }) {
  return (
    <View style={{ width: "31%", flexGrow: 1, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.line }}>
      <Text style={[type.display, { fontSize: 24 }]}>{value}</Text>
      <Text style={type.small}>{l}</Text>
    </View>
  );
}

function TableRow({ cells, head }: { cells: string[]; head?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      {cells.map((c, i) => (
        <Text key={i} style={[type.small, { flex: i === 0 ? 2 : 1, textAlign: i === 0 ? "left" : "right", color: head ? color.text : color.muted, fontWeight: head ? "800" : "500" }]}>
          {c}
        </Text>
      ))}
    </View>
  );
}
