import { battleResultSummary } from "@vybz/core";
import { Image } from "expo-image";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, ErrorBanner, Loading } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { resultCardUrl } from "@/lib/share-card";
import { useResource } from "@/lib/use-resource";

/**
 * Where a shared result's link lands (vybz://rematch/<battle>?by=<handle>):
 * the result, then one tap to challenge the player who shared it with the
 * same theme and rules. Players in the battle get a straight rematch.
 */
export default function Rematch() {
  const { id, by, code } = useLocalSearchParams<{ id: string; by?: string; code?: string }>();
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const battle = useResource(() => api.battle(id, code), [id, code, signedIn]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const b = battle.data;
  if (!b) {
    return battle.error ? (
      <View style={{ padding: space.lg }}>
        <ErrorBanner message={battle.error.status === 404 ? "This battle isn't available." : battle.error.message} onRetry={() => void battle.reload()} />
      </View>
    ) : (
      <Loading />
    );
  }

  const myId = b.viewer.participantId;
  const iPlayed = Boolean(myId);
  const target = (by ?? "").replace(/^@/, "").toLowerCase() || null;
  // Show it the way the sharer did: from their side if they played.
  const sharer = target && b.participants.some((p) => p.user.handle.toLowerCase() === target) ? target : null;
  const summary = battleResultSummary(b, sharer);
  const opponent = iPlayed ? (b.participants.find((p) => p.id !== myId)?.user.handle ?? null) : (sharer ?? summary.challengeHandle);
  const finished = b.status === "COMPLETE";

  const go = async () => {
    if (!signedIn) return router.push("/sign-in");
    setBusy(true);
    setError(null);
    try {
      const r = await api.rematch(b.id, iPlayed ? { code: code ?? null } : { against: opponent, code: code ?? null });
      router.replace({ pathname: "/battle/[id]", params: { id: r.id } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't start the battle.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, alignItems: "center", paddingBottom: space.xxl }}>
      <Stack.Screen options={{ title: iPlayed ? "Rematch" : "Take the challenge" }} />
      <Text style={[type.label, { textAlign: "center" }]}>{summary.theme}</Text>
      <Text style={[type.title, { textAlign: "center" }]}>{summary.headline}</Text>
      {finished ? <Image source={{ uri: resultCardUrl(b.id, sharer, code ?? null) }} style={styles.card} contentFit="cover" transition={200} /> : null}
      <Text style={[type.body, { textAlign: "center" }]}>
        {iPlayed
          ? `Same theme, same rules, ${b.rounds.length} rounds. @${opponent ?? "your opponent"} gets the challenge.`
          : `Same theme and rules: ${b.rules.roundCount} rounds${opponent ? ` against @${opponent}` : ""}. They get a notification to accept.`}
      </Text>
      {error ? <ErrorBanner message={error} /> : null}
      {!finished ? (
        <Link href={{ pathname: "/battle/[id]", params: { id: b.id, ...(code ? { code } : {}) } }} asChild>
          <Button title="See the battle" style={{ alignSelf: "stretch" }} />
        </Link>
      ) : signedIn ? (
        <Button title={iPlayed ? "Run it back" : `Take on @${opponent ?? "them"}`} onPress={() => void go()} loading={busy} disabled={!iPlayed && !opponent} style={{ alignSelf: "stretch" }} />
      ) : (
        <>
          <Link href="/sign-up" asChild>
            <Button title="Create an account to battle" style={{ alignSelf: "stretch" }} />
          </Link>
          <Link href="/sign-in" asChild>
            <Button title="I have an account" kind="ghost" style={{ alignSelf: "stretch" }} />
          </Link>
        </>
      )}
      <Link href={{ pathname: "/battle/[id]", params: { id: b.id, ...(code ? { code } : {}) } }} asChild>
        <Button title="See every round" kind="ghost" style={{ alignSelf: "stretch" }} />
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { width: 234, height: 416, borderRadius: radius.lg, backgroundColor: color.surface2 },
});
