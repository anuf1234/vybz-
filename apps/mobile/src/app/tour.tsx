import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button } from "@/components/ui";
import { useSession } from "@/lib/auth-client";
import { markTourSeen } from "@/lib/tour";

interface Slide {
  icon: string;
  tint: string;
  title: string;
  body: string;
  /** Three short examples under the text. */
  points: string[];
}

const SLIDES: Slide[] = [
  {
    icon: "🎧",
    tint: "#8B5CF6",
    title: "Battle with songs",
    body: "Each round has a theme. You and your opponent each pick a song for it.",
    points: ["Everyone listens to both picks", "The crowd votes, or the AI judges", "Win the most rounds, win the battle"],
  },
  {
    icon: "🥊",
    tint: "#F472B6",
    title: "Three ways to play",
    body: "Find them all on the Play tab.",
    points: ["Battle a friend with a link or a code", "Join a party on the big screen", "Play solo against the VYBZ bot"],
  },
  {
    icon: "🆕",
    tint: "#22D3EE",
    title: "New music every day",
    body: "Fresh releases land in Daily Drops every morning.",
    points: ["Pick your favorite in This or That", "Song of the Day and Album of the Week", "The weekly VYBZ Chart, ranked by fans"],
  },
  {
    icon: "📈",
    tint: "#39FF88",
    title: "Climb every week",
    body: "Battles, votes and trivia all earn XP.",
    points: ["Weekly leagues: the top move up on Monday", "Ranked seasons give you a badge", "Streaks and achievements along the way"],
  },
  {
    icon: "📣",
    tint: "#FBBF24",
    title: "Share and rematch",
    body: "Every result makes a card worth posting.",
    points: ["Send it to friends or your story", "They take you on in one tap", "Go live and stream battles to TikTok or a TV"],
  },
];

/**
 * The quick intro on first login (and from Profile → Take the tour): five
 * swipeable cards, skippable at any time. Brand-new players go on to pick
 * their genres.
 */
export default function Tour() {
  const router = useRouter();
  const session = useSession();
  const { then } = useLocalSearchParams<{ then?: string }>();
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollViewInstance>(null);
  const [page, setPage] = useState(0);
  const last = page === SLIDES.length - 1;

  const finish = async () => {
    const id = session.data?.user.id;
    if (id) await markTourSeen(id);
    if (then === "welcome") router.replace("/welcome");
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const go = (i: number) => {
    scroller.current?.scrollTo({ x: i * width, animated: true });
    setPage(i);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== page) setPage(i);
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <Text style={[type.label, { letterSpacing: 4 }]}>VYBZ</Text>
        {!last ? (
          <Pressable onPress={() => void finish()} accessibilityRole="button" hitSlop={12}>
            <Text style={[type.body, { color: color.muted, fontWeight: "700" }]}>Skip</Text>
          </Pressable>
        ) : (
          <View />
        )}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        onScroll={onScroll}
        scrollEventThrottle={64}
        style={{ flex: 1 }}
      >
        {SLIDES.map((s, i) => (
          <View key={s.title} style={[styles.slide, { width }]} accessibilityLabel={`${i + 1} of ${SLIDES.length}. ${s.title}. ${s.body} ${s.points.join(". ")}`}>
            <View style={[styles.badge, { backgroundColor: `${s.tint}26`, borderColor: s.tint }]}>
              <Text style={{ fontSize: 64 }}>{s.icon}</Text>
            </View>
            <Text style={[type.display, styles.title]}>{s.title}</Text>
            <Text style={[type.body, styles.body]}>{s.body}</Text>
            <View style={styles.points}>
              {s.points.map((p) => (
                <View key={p} style={styles.point}>
                  <View style={[styles.dot, { backgroundColor: s.tint }]} />
                  <Text style={[type.body, { flex: 1 }]}>{p}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.bottom}>
        <View style={styles.dots} accessibilityLabel={`Page ${page + 1} of ${SLIDES.length}`}>
          {SLIDES.map((s, i) => (
            <Pressable key={s.title} onPress={() => go(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Go to ${s.title}`}>
              <View style={[styles.pageDot, i === page && { width: 22, backgroundColor: SLIDES[page]!.tint }]} />
            </Pressable>
          ))}
        </View>
        <Button title={last ? (then === "welcome" ? "Pick my genres" : "Let's go") : "Next"} onPress={() => (last ? void finish() : go(page + 1))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.lg, paddingTop: 64, paddingBottom: space.sm },
  slide: { paddingHorizontal: space.xl, justifyContent: "center", alignItems: "center", gap: space.md },
  badge: { width: 140, height: 140, borderRadius: 70, borderWidth: 2, alignItems: "center", justifyContent: "center", marginBottom: space.md },
  title: { fontSize: 32, textAlign: "center" },
  body: { textAlign: "center", color: color.muted },
  points: { alignSelf: "stretch", gap: space.sm, marginTop: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  point: { flexDirection: "row", alignItems: "center", gap: space.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bottom: { padding: space.lg, paddingBottom: 48, gap: space.lg },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8 },
  pageDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.surface3 },
});
