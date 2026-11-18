import type { WarKind, WarPeriod } from "@vybz/core";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { color, space, type } from "@/components/theme";
import { EmptyState, ErrorBanner, Loading, Segmented } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** Best album (or single) of the week, month or year, by votes won in album wars. */
export default function WarRankings() {
  const [kind, setKind] = useState<WarKind>("ALBUM");
  const [period, setPeriod] = useState<WarPeriod>("week");
  const r = useResource(() => api.warRankings(kind, period), [kind, period]);
  const label = { week: "of the week", month: "of the month", year: "of the year" }[period];
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={r.refreshing} onRefresh={() => void r.reload()} />}>
      <Segmented value={kind} onChange={setKind} options={[{ value: "ALBUM", label: "Albums" }, { value: "SINGLE", label: "Singles" }]} />
      <Segmented value={period} onChange={setPeriod} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year" }]} />
      {r.error ? <ErrorBanner message={r.error.message} onRetry={() => void r.reload()} /> : null}
      {!r.data ? <Loading /> : null}
      {r.data && !r.data.rows.length ? <EmptyState title="No votes yet" body="Rankings fill in as people vote in wars." /> : null}
      {r.data?.rows[0] ? (
        <View style={{ alignItems: "center", gap: space.xs, paddingVertical: space.md }}>
          <Text style={type.label}>
            {kind === "ALBUM" ? "Album" : "Single"} {label}
          </Text>
          <Cover url={r.data.rows[0].artworkUrl} size={180} />
          <Text style={[type.title, { textAlign: "center" }]}>{r.data.rows[0].title}</Text>
          <Text style={type.small}>{r.data.rows[0].artistName}</Text>
        </View>
      ) : null}
      {r.data?.rows.map((row) => (
        <View key={row.ref} style={{ flexDirection: "row", gap: space.md, alignItems: "center" }} accessible accessibilityLabel={`${row.rank}. ${row.title} by ${row.artistName}, ${row.votes} votes`}>
          <Text style={[type.heading, { width: 28, textAlign: "center", color: row.rank <= 3 ? color.violetSoft : color.muted }]}>{row.rank}</Text>
          <Cover url={row.artworkUrl} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
              {row.title}
            </Text>
            <Text style={type.small} numberOfLines={1}>
              {row.artistName} · {row.wars} war{row.wars === 1 ? "" : "s"}
              {row.wins ? ` · ${row.wins} won` : ""}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={type.heading}>{row.votes}</Text>
            <Text style={type.small}>{row.share}%</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
