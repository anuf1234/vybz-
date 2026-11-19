import type { CatalogHit } from "@vybz/core";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, ErrorBanner, Field, Segmented } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { api } from "@/lib/api";

/** Staff: build a bracket. Songs are seeded in the order you add them (first = #1 seed). */
export default function NewTournament() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [size, setSize] = useState<"8" | "16">("16");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [picked, setPicked] = useState<CatalogHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(size);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setHits([]);
    const t = setTimeout(() => void api.search(term).then((r) => setHits(r.items)).catch(() => setHits([])), 300);
    return () => clearTimeout(t);
  }, [q]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await api.createTournament({ title: title.trim(), ...(description.trim() ? { description: description.trim() } : {}), catalogIds: picked.map((p) => p.catalogId) });
      router.replace({ pathname: "/tournaments/[id]", params: { id: t.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "New tournament" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <Field label="Title" value={title} onChangeText={setTitle} maxLength={80} placeholder="Best 2000s R&B song" />
        <Field label="Description (optional)" value={description} onChangeText={setDescription} maxLength={300} />
        <Segmented value={size} onChange={(v) => (setSize(v), setPicked((p) => p.slice(0, Number(v))))} options={[{ value: "8", label: "8 songs" }, { value: "16", label: "16 songs" }]} />
        <Text style={type.label}>
          Seeds ({picked.length}/{n})
        </Text>
        {picked.map((p, i) => (
          <View key={p.catalogId} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text style={[type.small, { width: 24, textAlign: "right" }]}>#{i + 1}</Text>
            <Cover url={p.artworkUrl ?? null} size={36} />
            <Text style={[type.small, { flex: 1, color: color.text }]} numberOfLines={1}>
              {p.title} · {p.artistName}
            </Text>
            <Text style={[type.small, { color: color.danger }]} onPress={() => setPicked((x) => x.filter((y) => y.catalogId !== p.catalogId))} accessibilityRole="button">
              Remove
            </Text>
          </View>
        ))}
        {picked.length < n ? <Field label="Add a song" value={q} onChangeText={setQ} placeholder="Search songs" autoCorrect={false} /> : null}
        {picked.length < n
          ? hits
              .filter((h) => !picked.some((p) => p.catalogId === h.catalogId))
              .slice(0, 8)
              .map((h) => (
                <Pressable key={h.catalogId} onPress={() => (setPicked((p) => [...p, h]), setQ(""))} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.xs, borderRadius: radius.sm, backgroundColor: color.surface1 }} accessibilityRole="button" accessibilityLabel={`Add ${h.title}`}>
                  <Cover url={h.artworkUrl ?? null} size={40} />
                  <Text style={[type.small, { flex: 1, color: color.text }]} numberOfLines={1}>
                    {h.title} · {h.artistName}
                  </Text>
                </Pressable>
              ))
          : null}
        {error ? <ErrorBanner message={error} /> : null}
        <Button title={busy ? "Creating…" : "Start the tournament"} disabled={busy || picked.length !== n || title.trim().length < 3} onPress={() => void create()} />
      </ScrollView>
    </>
  );
}
