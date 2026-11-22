import { type Href, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { useSession } from "@/lib/auth-client";
import { useServerConfig } from "@/lib/config";
import { usePro } from "@/lib/pro";

interface Mode {
  icon: string;
  title: string;
  blurb: string;
  href: Href;
}

/** Everything else, kept small so the three main ways in stand out. */
const MORE: { title: string; modes: Mode[] }[] = [
  {
    title: "Compete",
    modes: [
      { icon: "⚡", title: "Quick battle", blurb: "Matched with anyone in seconds", href: "/quick" },
      { icon: "📈", title: "Weekly league", blurb: "Earn XP, climb from Opening Act to Diamond", href: "/leagues" },
      { icon: "🏆", title: "Ranked", blurb: "Seasons, divisions, Bronze to Legend", href: "/ranked" },
      { icon: "🗂️", title: "Tournaments", blurb: "Vote the bracket", href: "/tournaments" },
      { icon: "➕", title: "Custom battle", blurb: "Your theme, rounds and rules", href: "/create" },
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
    title: "Extras",
    modes: [
      { icon: "🧠", title: "Trivia", blurb: "10 questions a day", href: "/trivia" },
      { icon: "🎧", title: "DJ Vybz", blurb: "Studio, DJ battles, DJ University", href: "/dj" },
    ],
  },
];

/** Three clear ways to start, then every other mode below. */
export default function Play() {
  const router = useRouter();
  const session = useSession();
  const pro = usePro();
  const config = useServerConfig();
  const bot = Boolean(config?.aiJudge.available);

  const main: (Mode & { tint: string })[] = [
    { icon: "🥊", title: "Battle a friend", blurb: "Pick a vibe, call them out, let the crowd decide", href: "/challenge", tint: color.violet },
    { icon: "🎉", title: "Join a party", blurb: "Enter a code or host one on the TV", href: "/party", tint: "#F472B6" },
    { icon: "🎯", title: "Play solo", blurb: bot ? "Battle the VYBZ bot, no waiting" : "Daily trivia, just you", href: bot ? { pathname: "/quick", params: { solo: "1" } } : "/trivia", tint: "#22D3EE" },
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      <View style={{ gap: space.sm }}>
        {main.map((m) => (
          <Pressable
            key={m.title}
            onPress={() => router.push(m.href)}
            style={({ pressed }) => [styles.hero, { borderColor: m.tint }, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}
            accessibilityRole="button"
            accessibilityLabel={`${m.title}: ${m.blurb}`}
          >
            <View style={[styles.heroIcon, { backgroundColor: `${m.tint}33` }]}>
              <Text style={{ fontSize: 30 }}>{m.icon}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.heading, { fontSize: 20 }]}>{m.title}</Text>
              <Text style={type.small}>{m.blurb}</Text>
            </View>
            <Text style={{ color: m.tint, fontSize: 24, fontWeight: "800" }}>›</Text>
          </Pressable>
        ))}
      </View>

      {MORE.map((s) => (
        <View key={s.title} style={{ gap: space.xs }}>
          <Text style={type.label}>{s.title.toUpperCase()}</Text>
          <View style={styles.list}>
            {s.modes.map((m, i) => (
              <Pressable
                key={m.title}
                onPress={() => router.push(m.href)}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && { backgroundColor: color.surface2 }]}
                accessibilityRole="button"
                accessibilityLabel={`${m.title}: ${m.blurb}`}
              >
                <Text style={{ fontSize: 20, width: 28, textAlign: "center" }}>{m.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { fontWeight: "700" }]}>{m.title}</Text>
                  <Text style={type.small}>{m.blurb}</Text>
                </View>
                <Text style={{ color: color.muted, fontSize: 20 }}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      {session.data && !pro.active ? (
        <Pressable onPress={() => router.push("/pro")} style={({ pressed }) => [styles.pro, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="VYBZ Pro: unlock all of DJ University">
          <Text style={[type.body, { fontWeight: "800" }]}>✨ VYBZ Pro</Text>
          <Text style={type.small}>All 11 DJ University courses, a Pro badge and 2 streak freezes every month.</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 2, backgroundColor: color.surface1 },
  heroIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.md },
  rowLine: { borderTopWidth: 1, borderTopColor: color.line },
  pro: { gap: 4, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.violet, backgroundColor: color.surface2 },
});
