import type { TournamentMatch, TournamentView } from "@vybz/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Loading, SectionTitle } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { API_URL, useSpotifyEnabled } from "@/lib/config";
import { listenOn } from "@/lib/listen";
import { shareMenu } from "@/lib/share-card";
import { useResource } from "@/lib/use-resource";

/** One tournament: vote this round's matchups; see earlier rounds and the champion. */
export default function Tournament() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const res = useResource(() => api.tournament(id!), [id]);
  const [busy, setBusy] = useState(false);
  const t = res.data;

  const vote = async (m: TournamentMatch, entry: number) => {
    if (!session.data) return router.push("/sign-in");
    if (busy || !t) return;
    setBusy(true);
    try {
      res.setData(await api.voteTournament(t.id, m.index, entry));
    } catch (err) {
      Alert.alert("Couldn't vote", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!t) return res.error ? <ErrorBanner message={res.error.message} onRetry={() => void res.reload()} /> : <Loading />;
  const current = t.status === "LIVE" ? t.rounds.at(-1) : null;
  const champ = t.champion !== null ? t.entries[t.champion] : null;
  return (
    <>
      <Stack.Screen options={{ title: "Tournament" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={res.refreshing} onRefresh={() => void res.reload()} />}>
        <Text style={type.title}>{t.title}</Text>
        {t.description ? <Text style={type.small}>{t.description}</Text> : null}
        <Text style={type.small}>
          {t.entries.length} songs · {t.voters} voter{t.voters === 1 ? "" : "s"}{current ? ` · ${current.name} ends ${new Date(t.roundEndsAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}
        </Text>
        {champ ? (
          <Card style={{ alignItems: "center", gap: space.sm, borderColor: color.violet }}>
            <Text style={type.label}>🏆 CHAMPION</Text>
            <Cover url={champ.artworkUrl} size={160} />
            <Text style={[type.heading, { textAlign: "center" }]}>{champ.title}</Text>
            <Text style={type.small}>{champ.artistName}</Text>
          </Card>
        ) : null}
        <Button
          title="Share this bracket"
          kind="secondary"
          onPress={() => shareMenu({ kind: "tournament", id: t.id, title: "Share the bracket", message: champ ? `${champ.title} won "${t.title}" on VYBZ.` : `"${t.title}" is live on VYBZ. Vote the bracket.`, url: API_URL })}
        />
        {current ? (
          <>
            <SectionTitle>{`${current.name}: vote`}</SectionTitle>
            {current.matches.map((m) => (
              <Match key={m.index} t={t} m={m} onVote={(e) => void vote(m, e)} disabled={busy} />
            ))}
          </>
        ) : null}
        {[...t.rounds]
          .filter((r) => r.done)
          .reverse()
          .map((r) => (
            <View key={r.name} style={{ gap: space.sm }}>
              <SectionTitle>{r.name}</SectionTitle>
              {r.matches.map((m) => (
                <Text key={m.index} style={type.small}>
                  <Text style={{ color: m.winner === m.a ? color.text : color.muted, fontWeight: m.winner === m.a ? "800" : "500" }}>{t.entries[m.a]!.title}</Text> {m.votesA}–{m.votesB}{" "}
                  <Text style={{ color: m.winner === m.b ? color.text : color.muted, fontWeight: m.winner === m.b ? "800" : "500" }}>{t.entries[m.b]!.title}</Text>
                </Text>
              ))}
            </View>
          ))}
      </ScrollView>
    </>
  );
}

function Match({ t, m, onVote, disabled }: { t: TournamentView; m: TournamentMatch; onVote: (entry: number) => void; disabled: boolean }) {
  const spotify = useSpotifyEnabled();
  const total = (m.votesA ?? 0) + (m.votesB ?? 0);
  const side = (e: number, votes: number | null) => {
    const x = t.entries[e]!;
    const mine = m.mine === e;
    return (
      <Pressable onPress={() => onVote(e)} disabled={disabled} style={({ pressed }) => [{ flex: 1, alignItems: "center", gap: 4, padding: space.sm, borderRadius: radius.md, borderWidth: 2, borderColor: mine ? color.violet : color.line, backgroundColor: color.surface1 }, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityState={{ selected: mine }} accessibilityLabel={`Vote ${x.title} by ${x.artistName}, seed ${e + 1}`}>
        <Cover url={x.artworkUrl} size={96} />
        <Text style={[type.small, { color: color.text, fontWeight: "800", textAlign: "center" }]} numberOfLines={2}>
          {x.title}
        </Text>
        <Text style={type.small} numberOfLines={1}>
          #{e + 1} · {x.artistName}
        </Text>
        {votes !== null ? <Text style={[type.small, { fontWeight: "800", color: mine ? color.violetSoft : color.muted }]}>{total ? Math.round((votes * 100) / total) : 0}%</Text> : null}
        {spotify ? (
          <Text style={[type.small, { color: color.violetSoft }]} onPress={() => void listenOn("spotify", "track", x.trackId)} accessibilityRole="link">
            Spotify ↗
          </Text>
        ) : null}
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      {side(m.a, m.votesA)}
      <Text style={[type.small, { fontWeight: "800" }]}>VS</Text>
      {side(m.b, m.votesB)}
    </View>
  );
}
