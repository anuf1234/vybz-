import { ROUND_COUNTS, type BattleRulesInput, type RoundCount } from "@vybz/core";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Field, Segmented, SectionTitle } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

const THEMES: { label: string; era?: [number, number] }[] = [
  { label: "2000s R&B", era: [2000, 2009] },
  { label: "90s Hip-Hop", era: [1990, 1999] },
  { label: "80s Synth", era: [1980, 1989] },
  { label: "Summer anthems" },
  { label: "Late-night drive" },
  { label: "Best opener" },
];

const PACES = {
  quick: { label: "Quick · 10 min", minutes: 10 },
  hour: { label: "1 hour", minutes: 60 },
  day: { label: "Daily · 24 h", minutes: 24 * 60 },
} as const;
type Pace = keyof typeof PACES;

export default function Create() {
  const session = useSession();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState<(typeof THEMES)[number] | null>(THEMES[0]!);
  const [useEra, setUseEra] = useState(true);
  const [rounds, setRounds] = useState<RoundCount>(5);
  const [mode, setMode] = useState<"open" | "direct">("open");
  const [handle, setHandle] = useState("");
  const [pace, setPace] = useState<Pace>("day");
  const [blind, setBlind] = useState(true);
  const [liveTallies, setLiveTallies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session.data && !session.isPending) {
    return (
      <EmptyState
        title="Sign in to start a battle"
        body="Pick a theme, choose rounds, and call someone out."
        action={
          <Link href="/sign-in" asChild>
            <Button title="Sign in" />
          </Link>
        }
      />
    );
  }

  const finalTitle = title.trim() || theme?.label || "";

  async function submit() {
    setError(null);
    if (finalTitle.length < 3) return setError("Give your battle a title (3+ characters).");
    if (mode === "direct" && !/^[a-z0-9_]{3,20}$/i.test(handle.replace(/^@/, ""))) return setError("Enter your opponent's handle.");
    const minutes = PACES[pace].minutes;
    const rules: BattleRulesInput = {
      roundCount: rounds,
      blindVoting: blind,
      revealTallies: liveTallies ? "LIVE" : "AT_ROUND_CLOSE",
      timing: { submissionWindowMinutes: minutes, votingWindowMinutes: minutes },
      ...(theme?.era && useEra ? { constraints: { eraFrom: theme.era[0], eraTo: theme.era[1] } } : {}),
    };
    setBusy(true);
    try {
      const { id } = await api.createBattle({
        title: finalTitle,
        ...(theme ? { theme: theme.label } : {}),
        ...(mode === "direct" ? { opponentHandle: handle.replace(/^@/, "").toLowerCase() } : {}),
        rules,
      });
      setTitle("");
      router.push({ pathname: "/battle/[id]", params: { id } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't create the battle.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <SectionTitle>Theme</SectionTitle>
        <View style={styles.chips}>
          {THEMES.map((t) => (
            <Chip key={t.label} label={t.label} active={theme?.label === t.label} onPress={() => setTheme(theme?.label === t.label ? null : t)} />
          ))}
        </View>
        {theme?.era ? (
          <Row label={`Only songs from ${theme.era[0]}–${theme.era[1]}`}>
            <Switch value={useEra} onValueChange={setUseEra} trackColor={{ true: color.violet, false: color.surface3 }} thumbColor={color.text} />
          </Row>
        ) : null}

        <Field label="Title" placeholder={theme?.label ?? "e.g. Nobody beats my 2000s R&B"} value={title} onChangeText={setTitle} maxLength={80} />

        <SectionTitle>Rounds</SectionTitle>
        <Segmented value={String(rounds)} onChange={(v) => setRounds(Number(v) as RoundCount)} options={ROUND_COUNTS.map((n) => ({ value: String(n), label: String(n) }))} />

        <SectionTitle>Opponent</SectionTitle>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "open", label: "Open challenge" },
            { value: "direct", label: "Call someone out" },
          ]}
        />
        {mode === "direct" ? <Field label="Their handle" placeholder="@handle" autoCapitalize="none" autoCorrect={false} value={handle} onChangeText={setHandle} /> : null}

        <SectionTitle>Pace</SectionTitle>
        <Segmented value={pace} onChange={setPace} options={(Object.keys(PACES) as Pace[]).map((k) => ({ value: k, label: PACES[k].label }))} />
        <Text style={type.small}>Time to pick each round, then the same again for voting.</Text>

        <SectionTitle>Rules</SectionTitle>
        <Row label="Blind voting" hint="Hide who picked what until the round ends">
          <Switch value={blind} onValueChange={setBlind} trackColor={{ true: color.violet, false: color.surface3 }} thumbColor={color.text} />
        </Row>
        <Row label="Live vote counts" hint="Show tallies while voting is open">
          <Switch value={liveTallies} onValueChange={setLiveTallies} trackColor={{ true: color.violet, false: color.surface3 }} thumbColor={color.text} />
        </Row>

        {error ? <ErrorBanner message={error} /> : null}
        <Button title={mode === "open" ? "Post open challenge" : "Send challenge"} onPress={() => void submit()} loading={busy} style={{ marginTop: space.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
      <Text style={{ color: active ? color.text : color.muted, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={type.body}>{label}</Text>
        {hint ? <Text style={type.small}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  chipActive: { borderColor: color.violet, backgroundColor: color.plum },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs },
});
