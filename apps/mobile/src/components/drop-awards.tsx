import { DROP_AWARDS, type HeatRow, type TopDropsResponse } from "@vybz/core";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "./theme";
import { Cover } from "./war-card";

const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
export const statLine = (s: HeatRow["stats"]) => `${s.fires} 🔥 · ${n(s.wins, "win", "wins")} · ${n(s.plays ?? 0, "play", "plays")} · ${n(s.listens, "listen", "listens")}`;

/** The three races at the top of Daily Drops: who's leading right now. */
export function AwardLeaders({ top }: { top: TopDropsResponse }) {
  const router = useRouter();
  const races = [
    { key: "SONG_DAY" as const, lead: top.songsToday[0] },
    { key: "SONG_WEEK" as const, lead: top.songsWeek[0] },
    { key: "ALBUM_WEEK" as const, lead: top.albumsWeek[0] },
  ];
  return (
    <Pressable onPress={() => router.push("/drops/top")} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel="Song of the Day, Song of the Week and Album of the Week. See the full race.">
      {races.map(({ key, lead }) => {
        const a = DROP_AWARDS[key];
        return (
          <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Cover url={lead?.release.artworkUrl ?? null} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={type.label}>
                {a.icon} {a.label.toUpperCase()}
              </Text>
              {lead ? (
                <>
                  <Text style={[type.body, { fontWeight: "800" }]} numberOfLines={1}>
                    {lead.release.title} · {lead.release.artistName}
                  </Text>
                  <Text style={type.small}>{statLine(lead.stats)}</Text>
                </>
              ) : (
                <Text style={type.small}>No votes yet. 🔥 or pick one in This or That.</Text>
              )}
            </View>
            {lead ? <Text style={[type.display, { fontSize: 20, color: color.violetSoft }]}>{lead.stats.score}</Text> : null}
          </View>
        );
      })}
      <Text style={[type.small, { color: color.violetSoft, textAlign: "right" }]}>See the full race ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.violet, backgroundColor: color.surface1 },
});
