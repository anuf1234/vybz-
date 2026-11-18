import { GENRES, type OnboardingState, genreLabel } from "@vybz/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Loading } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";

/** First run: pick your genres → play a quick battle → do today's trivia. */
export default function Welcome() {
  const router = useRouter();
  const [s, setS] = useState<OnboardingState | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.onboarding().then(
      (o) => {
        setS(o);
        setPicked(o.genres);
      },
      (err) => setError(err instanceof ApiRequestError ? err.message : "Couldn't load."),
    );
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveGenres = () => run(async () => setS(await api.updateOnboarding({ genres: picked })));
  const firstBattle = () =>
    run(async () => {
      const genre = s?.genres[0] ?? null;
      if (!s?.botAvailable) {
        router.replace({ pathname: "/quick", params: genre ? { genre } : {} });
        return;
      }
      const r = await api.quickBattle({ genre, decade: null, vsBot: true });
      router.replace({ pathname: "/battle/[id]", params: { id: r.id } });
    });
  const skip = () =>
    run(async () => {
      await api.updateOnboarding({ action: "skip" });
      router.replace("/");
    });

  if (error && !s) return <ErrorBanner message={error} />;
  if (!s) return <Loading />;
  const step = s.next === "genres" || !s.genres.length ? 0 : s.next === "battle" ? 1 : s.next === "trivia" ? 2 : 3;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      <View style={styles.dots} accessibilityLabel={`Step ${Math.min(step + 1, 3)} of 3`}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, i <= step && { backgroundColor: color.violet }]} />
        ))}
      </View>

      {step === 0 ? (
        <>
          <Text style={[type.display, { fontSize: 32 }]}>WELCOME TO VYBZ</Text>
          <Text style={type.body}>Battle your music taste. First, what do you listen to? Pick up to three.</Text>
          <View style={styles.grid}>
            {GENRES.map((g) => {
              const on = picked.includes(g.key);
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setPicked((p) => (on ? p.filter((x) => x !== g.key) : p.length >= 3 ? p : [...p, g.key]))}
                  style={[styles.genre, on && { borderColor: color.violet, backgroundColor: color.plum }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <Text style={[type.body, { fontWeight: on ? "800" : "500" }]}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Button title="Next" disabled={!picked.length} loading={busy} onPress={() => void saveGenres()} />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Text style={[type.display, { fontSize: 32 }]}>YOUR FIRST BATTLE</Text>
          <Card style={{ gap: space.sm }}>
            <Text style={type.heading}>How it works</Text>
            <Text style={type.body}>• 3 rounds{s.genres[0] ? ` of ${genreLabel(s.genres[0])}` : ""}. Pick one song each round.</Text>
            <Text style={type.body}>• {s.botAvailable ? "You're up against the VYBZ bot, so it starts right away." : "We'll match you with someone looking for a battle."}</Text>
            <Text style={type.body}>• The AI judge calls each round. Win rounds, win the battle, earn XP.</Text>
          </Card>
          <Button title={s.botAvailable ? "⚡ Play my first battle" : "⚡ Find my first battle"} loading={busy} onPress={() => void firstBattle()} />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={[type.display, { fontSize: 32 }]}>NOW: TODAY'S TRIVIA</Text>
          <Text style={type.body}>Ten questions, 20 seconds each. Everyone gets the same ones today, so see how you stack up. Finish it to collect your welcome bonus.</Text>
          <Button title="🧠 Play today's trivia" onPress={() => router.replace("/trivia")} />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Text style={[type.display, { fontSize: 32 }]}>YOU'RE ALL SET</Text>
          <Button title="Go to VYBZ" onPress={() => router.replace("/")} />
        </>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {step < 3 ? (
        <Pressable onPress={() => void skip()} hitSlop={10} accessibilityRole="button">
          <Text style={[type.small, { textAlign: "center" }]}>Skip for now</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", gap: 6 },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.surface3 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  genre: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.line, backgroundColor: color.surface1 },
});
