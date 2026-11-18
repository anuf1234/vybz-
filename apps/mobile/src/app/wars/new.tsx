import type { AlbumHit, CatalogHit, WarKind } from "@vybz/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Segmented } from "@/components/ui";
import { Cover } from "@/components/war-card";
import { ApiRequestError, api } from "@/lib/api";

type Pick = { ref: string; title: string; artistName: string; artworkUrl: string | null; releaseYear: number | null };

/** Pick two albums (or two songs) and start a war. */
export default function NewWar() {
  const params = useLocalSearchParams<{ kind?: string; a?: string; aTitle?: string }>();
  const router = useRouter();
  const [kind, setKind] = useState<WarKind>(params.kind === "SINGLE" ? "SINGLE" : "ALBUM");
  const [a, setA] = useState<Pick | null>(params.a ? { ref: params.a, title: params.aTitle ?? "Album", artistName: "", artworkUrl: null, releaseYear: null } : null);
  const [b, setB] = useState<Pick | null>(null);
  const [slot, setSlot] = useState<"A" | "B">(params.a ? "B" : "A");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Pick[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setHits([]);
    const n = ++seq.current;
    const t = setTimeout(() => {
      setSearching(true);
      const run =
        kind === "ALBUM"
          ? api.searchAlbums(term).then((r) => r.items.filter((x: AlbumHit) => !x.isSingle).map((x) => ({ ref: x.ref, title: x.title, artistName: x.artistName, artworkUrl: x.artworkUrl, releaseYear: x.releaseYear })))
          : api.search(term).then((r) => r.items.map((x: CatalogHit) => ({ ref: x.catalogId, title: x.title, artistName: x.artistName, artworkUrl: x.artworkUrl ?? null, releaseYear: x.releaseYear ?? null })));
      run
        .then((items) => n === seq.current && setHits(items))
        .catch((err) => n === seq.current && setError(err instanceof ApiRequestError ? err.message : "Search failed."))
        .finally(() => n === seq.current && setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [q, kind]);

  const choose = (p: Pick) => {
    if (slot === "A") {
      setA(p);
      setSlot("B");
    } else {
      setB(p);
    }
    setQ("");
    setHits([]);
  };

  const start = async () => {
    if (!a || !b) return;
    setBusy(true);
    setError(null);
    try {
      const w = await api.createWar(kind, a.ref, b.ref);
      router.replace({ pathname: "/wars/[id]", params: { id: w.id } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't start that war.");
    } finally {
      setBusy(false);
    }
  };

  const Slot = ({ s, p }: { s: "A" | "B"; p: Pick | null }) => (
    <Pressable onPress={() => setSlot(s)} style={{ flex: 1, alignItems: "center", gap: 4, padding: space.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: slot === s ? color.violet : color.line, backgroundColor: color.surface1 }} accessibilityRole="button" accessibilityLabel={`Side ${s}: ${p?.title ?? "empty"}`}>
      <Cover url={p?.artworkUrl ?? null} size={90} />
      <Text style={[type.body, { fontWeight: "800", textAlign: "center" }]} numberOfLines={2}>
        {p?.title ?? `Pick ${s === "A" ? "the first" : "the second"}`}
      </Text>
      {p?.artistName ? <Text style={type.small}>{p.artistName}</Text> : null}
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
      <Segmented
        value={kind}
        onChange={(k) => {
          setKind(k);
          setA(null);
          setB(null);
          setSlot("A");
        }}
        options={[
          { value: "ALBUM", label: "Album war" },
          { value: "SINGLE", label: "Single war" },
        ]}
      />
      <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
        <Slot s="A" p={a} />
        <Text style={[type.display, { fontSize: 22, color: color.muted }]}>VS</Text>
        <Slot s="B" p={b} />
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder={`Search ${kind === "ALBUM" ? "albums" : "songs"} for side ${slot}`}
        placeholderTextColor={color.lose}
        autoCorrect={false}
        accessibilityLabel="Search"
        style={{ backgroundColor: color.surface1, borderColor: color.line, borderWidth: 1, borderRadius: radius.md, padding: space.md, color: color.text, fontSize: 16 }}
      />
      {searching ? <ActivityIndicator color={color.violet} /> : null}
      {hits.map((h) => (
        <Pressable key={h.ref} onPress={() => choose(h)} style={{ flexDirection: "row", gap: space.md, alignItems: "center" }} accessibilityRole="button">
          <Cover url={h.artworkUrl} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
              {h.title}
            </Text>
            <Text style={type.small} numberOfLines={1}>
              {h.artistName}
              {h.releaseYear ? ` · ${h.releaseYear}` : ""}
            </Text>
          </View>
        </Pressable>
      ))}
      {error ? <ErrorBanner message={error} /> : null}
      <Card style={{ gap: space.xs }}>
        <Text style={type.small}>Voting runs for a week. Fans vote on {kind === "ALBUM" ? "the overall album, best songs, production, lyrics and replay value, plus track-by-track battles" : "the better song, production, lyrics and replay value"}.</Text>
      </Card>
      <Button title="Start the war" disabled={!a || !b} loading={busy} onPress={() => void start()} />
    </ScrollView>
  );
}
