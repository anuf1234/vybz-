import { DECADES, GENRES, battleCodeLabel, decadeLabel, normalizeBattleCode, themeLabel } from "@vybz/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { DEFAULT_TERMS, termsToRules } from "@/components/terms-form";
import { color, radius, space, type } from "@/components/theme";
import { GuestOrSignIn, SaveAccountBanner, useIsGuest } from "@/components/guest";
import { Avatar, Button, Card, ErrorBanner, Field } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { API_URL, useServerConfig } from "@/lib/config";
import { useResource } from "@/lib/use-resource";

/**
 * Battle a friend in two taps: pick a vibe, then pick someone you follow or
 * send a link to anyone. Three rounds, decided within a day; the AI judge
 * helps call it when it's on, so a private battle never stalls for votes.
 */
export default function Challenge() {
  const router = useRouter();
  const session = useSession();
  const config = useServerConfig();
  const me = useResource(() => (session.data ? api.me() : Promise.resolve(null)), [Boolean(session.data)]);
  const following = useResource(() => (me.data ? api.followList(me.data.handle, "following") : Promise.resolve({ items: [] })), [me.data?.handle]);
  const [genre, setGenre] = useState<string | null>("rnb");
  const [decade, setDecade] = useState<number | null>(2000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guest = useIsGuest();

  if (!session.data && !session.isPending) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.xs }}>
          <Text style={type.title}>Got a code from a friend?</Text>
          <Text style={type.small}>Play as a guest to enter it, or sign in to send your own challenges.</Text>
        </View>
        <GuestOrSignIn action="Continue" />
      </ScrollView>
    );
  }

  const theme = themeLabel({ genres: genre ? [genre] : undefined, eraFrom: decade ?? undefined, eraTo: decade !== null ? decade + 9 : undefined });
  const ai = Boolean(config?.aiJudge.available);
  const rules = termsToRules({ ...DEFAULT_TERMS, format: "DUEL", genres: genre ? [genre] : [], decade, rounds: 3, duration: "24h", judging: ai ? "COMBINED" : "CROWD" });
  const title = theme ? `${theme} battle` : "Open battle";

  const challenge = async (handle: string) => {
    setBusy(handle);
    setError(null);
    try {
      const { id } = await api.createBattle({ title, opponentHandle: handle, visibility: "PUBLIC", rules });
      router.replace({ pathname: "/battle/[id]", params: { id } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't send the challenge.");
    } finally {
      setBusy(null);
    }
  };

  // A private open challenge: only people with the link can take it.
  const sendLink = async () => {
    setBusy("link");
    setError(null);
    try {
      const { id } = await api.createBattle({ title, visibility: "PRIVATE", rules });
      const b = await api.battle(id);
      const link = `${API_URL}/battle/${id}${b.inviteCode ? `?code=${b.inviteCode}` : ""}`;
      await Share.share({ message: `I'm calling you out on VYBZ: ${title}, 3 rounds. Think your taste beats mine? ${link}${b.joinCode ? ` (or enter code ${battleCodeLabel(b.joinCode)} in VYBZ)` : ""}` });
      router.replace({ pathname: "/battle/[id]", params: { id } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't make the challenge.");
    } finally {
      setBusy(null);
    }
  };

  const people = following.data?.items ?? [];

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
      <CodeEntry />
      {guest ? <SaveAccountBanner note="Save your account to send your own challenges. You can still take a friend's with their code or link." /> : null}
      <View style={{ gap: space.xs, opacity: guest ? 0.5 : 1 }} pointerEvents={guest ? "none" : "auto"}>
        <Text style={type.title}>Pick the vibe</Text>
        <Text style={type.small}>3 rounds, one song each. {ai ? "The crowd and the AI judge decide." : "The crowd decides."}</Text>
      </View>
      <Card style={{ gap: space.sm, ...(guest ? { opacity: 0.5 } : {}) }}>
        <Text style={type.label}>Genre</Text>
        <View style={styles.wrap}>
          <Chip label="Any" active={genre === null} onPress={() => setGenre(null)} />
          {GENRES.map((g) => (
            <Chip key={g.key} label={g.label} active={genre === g.key} onPress={() => setGenre(g.key)} />
          ))}
        </View>
        <Text style={[type.label, { marginTop: space.sm }]}>Era</Text>
        <View style={styles.wrap}>
          <Chip label="Any" active={decade === null} onPress={() => setDecade(null)} />
          {DECADES.map((d) => (
            <Chip key={d} label={decadeLabel(d)} active={decade === d} onPress={() => setDecade(d)} />
          ))}
        </View>
      </Card>

      <View style={{ gap: space.sm }}>
        <Text style={type.title}>Who are you calling out?</Text>
        <Button title="Send a challenge link" onPress={() => void sendLink()} loading={busy === "link"} disabled={busy !== null || guest} />
        <Text style={type.small}>Text it to anyone, or read them the code. Whoever opens it first takes you on, no account needed.</Text>
      </View>
      {error ? <ErrorBanner message={error} /> : null}

      {people.length ? (
        <View style={{ gap: space.sm }}>
          <Text style={type.label}>PEOPLE YOU FOLLOW</Text>
          {people.slice(0, 30).map((u) => (
            <Pressable
              key={u.id}
              onPress={() => void challenge(u.handle)}
              disabled={busy !== null || guest}
              accessibilityRole="button"
              accessibilityLabel={`Challenge @${u.handle}`}
              style={({ pressed }) => [styles.person, pressed && { opacity: 0.85 }]}
            >
              <Avatar name={u.displayName || u.handle} image={u.image} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { fontWeight: "700" }]}>{u.displayName || u.handle}</Text>
                <Text style={type.small}>@{u.handle}</Text>
              </View>
              <Text style={{ color: color.violetSoft, fontWeight: "800" }}>{busy === u.handle ? "Sending…" : "Challenge"}</Text>
            </Pressable>
          ))}
        </View>
      ) : following.data ? (
        <Text style={type.small}>Follow people to challenge them straight from here.</Text>
      ) : null}
    </ScrollView>
  );
}

/** Type a friend's six-letter code to open their challenge. */
function CodeEntry() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = normalizeBattleCode(code);
  const open = async () => {
    if (!valid) return setError("Codes are six letters, like ABC-DEF.");
    setBusy(true);
    setError(null);
    try {
      const r = await api.battleByCode(valid);
      router.push({ pathname: "/battle/[id]", params: { id: r.id, code: r.code } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't find that challenge.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: space.sm }}>
      <Text style={type.label}>GOT A CODE?</Text>
      <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <Field label="Battle code" placeholder="ABC-DEF" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={7} onSubmitEditing={() => void open()} />
        </View>
        <Button title="Open" onPress={() => void open()} loading={busy} disabled={!code} />
      </View>
      {error ? <Text style={[type.small, { color: color.danger }]}>{error}</Text> : null}
    </Card>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
      <Text style={{ color: active ? color.text : color.muted, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  chipActive: { borderColor: color.violet, backgroundColor: color.plum },
  person: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
});
