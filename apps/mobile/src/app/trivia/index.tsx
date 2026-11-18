import type { TriviaCategory } from "@vybz/core";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Chips, GENRE_OPTIONS, TriviaLeader } from "@/components/chips";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

/** Trivia home: the daily 10, practice by category, streak and today's top scores. */
export default function TriviaHub() {
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const hub = useResource(() => (signedIn ? api.triviaHub() : Promise.resolve(null)), [signedIn]);
  const [genre, setGenre] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn && !session.isPending) {
    return (
      <EmptyState
        title="Music trivia"
        body="Ten questions a day, a streak to keep and a leaderboard to climb. Sign in to play."
        action={
          <Link href="/sign-in" asChild>
            <Button title="Sign in" />
          </Link>
        }
      />
    );
  }
  if (hub.error && !hub.data) return <ErrorBanner message={hub.error.message} onRetry={() => void hub.reload()} />;
  const h = hub.data;
  if (!h) return <Loading />;

  const start = async (key: string, body: Parameters<typeof api.triviaStart>[0]) => {
    setBusy(key);
    setError(null);
    try {
      const play = await api.triviaStart(body);
      router.push({ pathname: "/trivia/[id]", params: { id: play.id } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't start that game.");
    } finally {
      setBusy(null);
    }
  };

  const d = h.daily;
  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={hub.refreshing} onRefresh={() => void hub.reload()} />}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <View style={{ gap: space.xs, flex: 1 }}>
          <Text style={[type.display, { fontSize: 30 }]}>MUSIC TRIVIA</Text>
          <Text style={type.small}>Prove you know music. Then go win a battle.</Text>
        </View>
        <View style={styles.streak} accessibilityLabel={`Trivia streak ${h.streak.current} days, best ${h.streak.best}`}>
          <Text style={[type.title, { color: h.streak.current ? color.sideB : color.muted }]}>🔥 {h.streak.current}</Text>
          <Text style={type.small}>best {h.streak.best}</Text>
        </View>
      </View>

      <Card style={{ gap: space.md, borderColor: color.violet }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={type.label}>Daily challenge · {h.day}</Text>
          <Text style={type.small}>{d.players} played</Text>
        </View>
        <Text style={type.title}>Today's 10</Text>
        <Text style={type.small}>Everyone gets the same questions. 20 seconds each, faster answers score more. One go per day.</Text>
        {d.status === "FINISHED" ? (
          <>
            <Text style={[type.heading, { color: color.win }]}>Done today: {d.score} points</Text>
            <Button title="See your results" kind="secondary" onPress={() => router.push({ pathname: "/trivia/[id]", params: { id: d.playId! } })} />
          </>
        ) : (
          <Button title={d.status === "IN_PROGRESS" ? "Continue" : "Play today's 10"} loading={busy === "daily"} onPress={() => void start("daily", { mode: "DAILY" })} />
        )}
      </Card>

      {error ? <ErrorBanner message={error} /> : null}

      <View style={{ gap: space.md }}>
        <SectionTitle right={<Text style={type.small}>{h.practiceRewardsLeft ? `XP for ${h.practiceRewardsLeft} more today` : "No more XP today"}</Text>}>
          Practice
        </SectionTitle>
        <Chips value={genre} options={GENRE_OPTIONS} onChange={setGenre} anyLabel="Any genre" />
        <View style={styles.grid}>
          {h.categories.map((c) => {
            const genreFits = c.category === "GENRE" || c.category === "ARTIST";
            return (
              <Pressable
                key={c.category}
                disabled={!c.available || busy !== null}
                onPress={() => void start(c.category, { mode: "PRACTICE", category: c.category as TriviaCategory, genre: genreFits ? genre : null })}
                style={({ pressed }) => [styles.cat, !c.available && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel={`${c.label}${c.available ? "" : ", coming soon"}`}
              >
                <Text style={{ fontSize: 26 }}>{c.icon}</Text>
                <Text style={type.heading}>{c.label}</Text>
                <Text style={type.small} numberOfLines={2}>
                  {c.available ? c.blurb : "Coming soon"}
                </Text>
                {busy === c.category ? <Text style={[type.small, { color: color.violetSoft }]}>Starting…</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <SectionTitle
          right={
            <Pressable onPress={() => router.push("/trivia/leaderboard")} accessibilityRole="link" hitSlop={8}>
              <Text style={[type.small, { color: color.violetSoft }]}>Full leaderboard</Text>
            </Pressable>
          }
        >
          Today's top scores
        </SectionTitle>
        {h.top.length ? h.top.map((r) => <TriviaLeader key={r.user.id} row={r} />) : <Text style={type.small}>Nobody has played today yet. Be first.</Text>}
      </View>

      <Link href="/achievements" asChild>
        <Button title="🏅 Trivia badges" kind="ghost" />
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  streak: { alignItems: "flex-end" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  cat: { width: "47%", flexGrow: 1, gap: space.xs, padding: space.md, borderRadius: radius.lg, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.line },
});
