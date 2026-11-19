import { type Href, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { useSession } from "@/lib/auth-client";
import { usePro } from "@/lib/pro";

interface Mode {
  icon: string;
  title: string;
  blurb: string;
  href: Href;
  badge?: string;
}

const SECTIONS: { title: string; modes: Mode[] }[] = [
  {
    title: "Battle",
    modes: [
      { icon: "⚡", title: "Quick battle", blurb: "Matched in seconds", href: "/quick" },
      { icon: "🏆", title: "Ranked", blurb: "Climb Bronze to Legend", href: "/ranked" },
      { icon: "➕", title: "Custom battle", blurb: "Your theme, your rules", href: "/create" },
      { icon: "🗂️", title: "Tournaments", blurb: "Vote the bracket", href: "/tournaments" },
    ],
  },
  {
    title: "New music",
    modes: [
      { icon: "🆕", title: "Daily Drops", blurb: "Out today", href: "/drops" },
      { icon: "🆚", title: "This or That", blurb: "Rank new releases", href: "/verdict" },
      { icon: "📊", title: "VYBZ Chart", blurb: "Ranked by fans", href: "/chart" },
      { icon: "💿", title: "Album Wars", blurb: "Album vs album", href: "/wars" },
    ],
  },
  {
    title: "More ways to play",
    modes: [
      { icon: "🧠", title: "Trivia", blurb: "Daily 10 questions", href: "/trivia" },
      { icon: "🎉", title: "Party Mode", blurb: "TV + phones", href: "/party" },
      { icon: "🎧", title: "DJ Vybz", blurb: "Studio, battles, DJ University", href: "/dj" },
    ],
  },
];

/** Every way to play, in one place, so Home can stay focused on today. */
export default function Play() {
  const router = useRouter();
  const session = useSession();
  const pro = usePro();
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      {session.data && !pro.active ? (
        <Pressable onPress={() => router.push("/pro")} style={({ pressed }) => [styles.pro, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="VYBZ Pro: unlock all of DJ University">
          <Text style={[type.body, { fontWeight: "800" }]}>✨ VYBZ Pro</Text>
          <Text style={type.small}>All 11 DJ University courses, a Pro badge and 2 streak freezes every month.</Text>
        </Pressable>
      ) : null}
      {SECTIONS.map((s) => (
        <View key={s.title} style={{ gap: space.sm }}>
          <Text style={type.label}>{s.title.toUpperCase()}</Text>
          <View style={styles.grid}>
            {s.modes.map((m) => (
              <Pressable key={m.title} onPress={() => router.push(m.href)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`${m.title}: ${m.blurb}`}>
                <Text style={{ fontSize: 28 }}>{m.icon}</Text>
                <Text style={[type.body, { fontWeight: "800" }]}>{m.title}</Text>
                <Text style={type.small}>{m.blurb}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: { width: "48.5%", gap: 4, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  pro: { gap: 4, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.violet, backgroundColor: color.surface2 },
});
