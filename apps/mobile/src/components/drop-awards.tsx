import { DROP_AWARDS, type TopDropsResponse } from "@vybz/core";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "./theme";
import { Cover } from "./war-card";

/** The three races at the top of Daily Drops: who's leading right now. */
export function AwardLeaders({ top }: { top: TopDropsResponse }) {
  const router = useRouter();
  const races = [
    { key: "SONG_DAY" as const, lead: top.songsToday[0] },
    { key: "SONG_WEEK" as const, lead: top.songsWeek[0] },
    { key: "ALBUM_WEEK" as const, lead: top.albumsWeek[0] },
  ];
  return (
    <Pressable onPress={() => router.push("/drops/top")} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel="Song of the Day, Song of the Week and Album of the Week. See the top charts.">
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
                    {lead.release.title}
                  </Text>
                  <Text style={type.small} numberOfLines={1}>
                    {lead.release.artistName}
                  </Text>
                </>
              ) : (
                <Text style={type.small}>Coming soon. 🔥 your favorites and pick in This or That.</Text>
              )}
            </View>
          </View>
        );
      })}
      <Text style={[type.small, { color: color.violetSoft, textAlign: "right" }]}>See the top charts ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.violet, backgroundColor: color.surface1 },
});
