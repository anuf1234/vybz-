import { DJ_LESSONS } from "@vybz/core";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner, SectionTitle } from "@/components/ui";
import { BattleRow } from "@/components/dj-battle-row";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

/** DJ Vybz: learn in DJ University, practise in the studio, then battle. */
export default function DjHub() {
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const uni = useResource(() => (signedIn ? api.djUniversity() : Promise.resolve(null)), [signedIn]);
  const voting = useResource(() => api.djBattles("VOTING"), []);
  const open = useResource(() => api.djBattles("OPEN"), []);
  useFocusEffect(
    useCallback(() => {
      void uni.reload();
      void voting.reload();
      void open.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const u = uni.data;
  const next = u?.lessons.find((l) => !l.progress.completed) ?? null;
  const step = !u || u.completed === 0 ? 0 : u.completed < u.total ? 1 : 2;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={uni.refreshing} onRefresh={() => void Promise.all([uni.reload(), voting.reload(), open.reload()])} />}
    >
      <View style={{ gap: space.xs }}>
        <Text style={[type.display, { fontSize: 30 }]}>DJ VYBZ</Text>
        <Text style={type.small}>Learn the craft, practise on two decks, then battle other DJs.</Text>
      </View>

      <View style={styles.path} accessibilityLabel={`Your path: ${["learn", "practice", "battle"][step]}`}>
        {["LEARN", "PRACTICE", "BATTLE"].map((s, i) => (
          <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flex: 1 }}>
            <View style={[styles.stepDot, i <= step && { backgroundColor: color.violet, borderColor: color.violet }]}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{i + 1}</Text>
            </View>
            <Text style={[type.label, i <= step && { color: color.text }]}>{s}</Text>
            {i < 2 ? <Text style={type.small}>→</Text> : null}
          </View>
        ))}
      </View>

      <Button title="🎧 Open DJ Vybz Studio" onPress={() => router.push({ pathname: "/dj/studio", params: { path: "/studio" } })} />

      <Card style={{ gap: space.sm }}>
        <SectionTitle right={u ? <Text style={type.small}>{u.completed}/{u.total} done</Text> : undefined}>DJ University</SectionTitle>
        {!signedIn ? (
          <Text style={type.small}>Sign in to track your lessons and earn XP.</Text>
        ) : next ? (
          <>
            <Text style={type.heading}>
              Up next: {next.icon} {next.course}
            </Text>
            <Text style={type.small}>{next.summary}</Text>
            <Button title={u!.completed ? "Continue" : "Start your first lesson"} onPress={() => router.push({ pathname: "/dj/lesson/[id]", params: { id: next.id } })} />
          </>
        ) : u ? (
          <Text style={type.heading}>🎓 You've finished every course. Time to battle.</Text>
        ) : null}
        <Link href="/dj/university" asChild>
          <Button title={`All ${DJ_LESSONS.length} courses`} kind="secondary" />
        </Link>
      </Card>

      <View style={{ gap: space.sm }}>
        <SectionTitle>DJ battles · vote now</SectionTitle>
        {voting.error ? <ErrorBanner message={voting.error.message} onRetry={() => void voting.reload()} /> : null}
        {voting.data && !voting.data.items.length ? <Text style={type.small}>No battles are being voted on right now.</Text> : null}
        {voting.data?.items.map((b) => (
          <BattleRow key={b.id} id={b.id} title={b.title} a={b.a.dj.handle} b={b.b?.dj.handle ?? null} note={b.votingEndsAt ? `Voting closes ${new Date(b.votingEndsAt).toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""} />
        ))}
      </View>

      <View style={{ gap: space.sm }}>
        <SectionTitle>Open challenges</SectionTitle>
        {open.data && !open.data.items.length ? (
          <EmptyState title="No open challenges" body="Record a battle set in the studio and start one." />
        ) : (
          open.data?.items.map((b) => <BattleRow key={b.id} id={b.id} title={b.title} a={b.a.dj.handle} b={null} note="Take it on with your own battle set" />)
        )}
      </View>

      <Link href="/dj/battles" asChild>
        <Button title="All DJ battles and results" kind="ghost" />
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  path: { flexDirection: "row", alignItems: "center", padding: space.md, borderRadius: radius.lg, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.line },
  stepDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: color.line, backgroundColor: color.surface3 },
});
