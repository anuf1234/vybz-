import { DECADES, GENRES, decadeLabel } from "@vybz/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, ErrorBanner, Field, SectionTitle, Segmented } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";

const SIZES = ["15", "25", "40"] as const;

/** Make a playlist, empty or filled with suggestions for a genre and era. */
export default function NewPlaylist() {
  const params = useLocalSearchParams<{ generate?: string }>();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [generate, setGenerate] = useState(params.generate === "1");
  const [genres, setGenres] = useState<string[]>([]);
  const [decade, setDecade] = useState<number | null>(null);
  const [size, setSize] = useState<(typeof SIZES)[number]>("25");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const auto = [decade !== null ? decadeLabel(decade) : "", genres.map((g) => GENRES.find((x) => x.key === g)?.label).join(" & ")].filter(Boolean).join(" ");
  const finalTitle = title.trim() || (generate && auto ? auto : "");

  const toggleGenre = (key: string) => setGenres((cur) => (cur.includes(key) ? cur.filter((g) => g !== key) : cur.length >= 3 ? cur : [...cur, key]));

  async function create() {
    if (!finalTitle) return setError("Give your playlist a name.");
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createPlaylist({
        title: finalTitle,
        ...(description.trim() ? { description: description.trim() } : {}),
        visibility,
        ...(generate ? { generate: { genres, ...(decade !== null ? { eraFrom: decade, eraTo: decade + 9 } : {}), size: Number(size) } } : {}),
      });
      router.replace({ pathname: "/playlist/[id]", params: { id } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't make the playlist.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <Field label="Name" placeholder={generate && auto ? auto : "e.g. Late night drive"} value={title} onChangeText={setTitle} maxLength={80} />
        <Field label="Description (optional)" value={description} onChangeText={setDescription} maxLength={500} multiline />
        <SectionTitle>Who can see it</SectionTitle>
        <Segmented
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "PRIVATE", label: "Private · link only" },
            { value: "PUBLIC", label: "Public" },
          ]}
        />

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={type.body}>Fill it for me</Text>
            <Text style={type.small}>Start with popular songs for a genre and era. You can change them after.</Text>
          </View>
          <Switch value={generate} onValueChange={setGenerate} trackColor={{ true: color.violet }} accessibilityLabel="Fill it for me" />
        </View>

        {generate ? (
          <>
            <SectionTitle>Genres (up to 3)</SectionTitle>
            <View style={styles.chips}>
              <Chip label="Any" active={genres.length === 0} onPress={() => setGenres([])} />
              {GENRES.map((g) => (
                <Chip key={g.key} label={g.label} active={genres.includes(g.key)} onPress={() => toggleGenre(g.key)} />
              ))}
            </View>
            <SectionTitle>Era</SectionTitle>
            <View style={styles.chips}>
              <Chip label="Any era" active={decade === null} onPress={() => setDecade(null)} />
              {DECADES.map((d) => (
                <Chip key={d} label={decadeLabel(d)} active={decade === d} onPress={() => setDecade(d)} />
              ))}
            </View>
            <SectionTitle>How many songs</SectionTitle>
            <Segmented value={size} onChange={setSize} options={SIZES.map((s) => ({ value: s, label: s }))} />
          </>
        ) : null}

        {error ? <ErrorBanner message={error} /> : null}
        <Button title={generate ? "Make my playlist" : "Create playlist"} onPress={() => void create()} loading={busy} style={{ marginTop: space.md }} />
        {generate && busy ? <Text style={[type.small, { textAlign: "center" }]}>Finding songs… this can take a few seconds.</Text> : null}
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

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  chipActive: { borderColor: color.violet, backgroundColor: color.plum },
});
