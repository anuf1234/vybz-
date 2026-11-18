import { TRIVIA_CATEGORY_INFO, type TriviaAdminQuestion, type TriviaCategory, type TriviaQuestionStatus, genreLabel } from "@vybz/core";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Chips, GENRE_OPTIONS } from "@/components/chips";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner, Field, Loading, Pill, Segmented } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

type Tab = TriviaQuestionStatus | "FLAGGED";
type Writable = "GENRE" | "ARTIST" | "HISTORY";
const WRITABLE: { value: Writable; label: string }[] = [
  { value: "GENRE", label: "Genre" },
  { value: "ARTIST", label: "Artist" },
  { value: "HISTORY", label: "History" },
];
const CATEGORY_FILTER = (["GENRE", "ARTIST", "ALBUM_ART", "HISTORY", "GUESS_SONG"] as TriviaCategory[]).map((c) => ({ value: c, label: TRIVIA_CATEGORY_INFO[c].label }));

/** Staff only: review drafts and flagged questions, write new ones, generate from the catalog or draft with AI. */
export default function TriviaAdmin() {
  const [tab, setTab] = useState<Tab>("DRAFT");
  const [category, setCategory] = useState<TriviaCategory | null>(null);
  const [q, setQ] = useState("");
  const list = useResource(() => api.modTrivia(tab, category, q.trim() || undefined), [tab, category, q]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TriviaAdminQuestion | "new" | null>(null);
  const [aiCat, setAiCat] = useState<Writable>("GENRE");
  const [aiGenre, setAiGenre] = useState<string | null>(null);
  const router = useRouter();
  const health = useResource(() => api.triviaHealth(), []);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const msg = await fn();
      if (msg) setNote(msg);
      await list.reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (item: TriviaAdminQuestion, status: TriviaQuestionStatus) => run(`${item.id}:${status}`, async () => void (await api.modTriviaUpdate(item.id, { status })));
  const counts = list.data?.counts;
  const label = (s: Tab, text: string) => `${text}${counts ? ` ${counts[s]}` : ""}`;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={list.refreshing} onRefresh={() => void list.reload()} />}
      keyboardShouldPersistTaps="handled"
    >
      {health.data ? (
        <Card style={{ gap: space.sm, borderColor: health.data.low ? color.danger : color.line }}>
          <Text style={type.label}>Question bank</Text>
          <Text style={[type.title, { color: health.data.low ? color.danger : color.text }]}>
            {health.data.daysLeft} days of daily trivia left
          </Text>
          <Text style={type.small}>
            {health.data.fresh} fresh questions · {health.data.drafts} drafts waiting · thinnest: {health.data.thinGenres
              .slice(0, 3)
              .map((g) => `${g.label} (${g.approved})`)
              .join(", ")}
          </Text>
          <Text style={type.small}>
            {health.data.lastRun ? `Last weekly run ${new Date(health.data.lastRun.at).toLocaleDateString()}: ${health.data.lastRun.note ?? ""}` : "The weekly pipeline hasn't run yet."}
            {health.data.aiReady || health.data.lastRun?.note?.includes("ANTHROPIC_API_KEY") ? "" : " AI drafting needs ANTHROPIC_API_KEY."}
          </Text>
          {health.data.drafts ? <Button title={`Review ${health.data.drafts} drafts one by one`} onPress={() => router.push("/mod/trivia-review")} /> : null}
          <Button
            title="Run the pipeline now"
            kind="secondary"
            loading={busy === "pipe"}
            onPress={() =>
              void run("pipe", async () => {
                const r = await api.runTriviaPipeline();
                await health.reload();
                return r.note;
              })
            }
          />
        </Card>
      ) : null}

      <Card style={{ gap: space.sm }}>
        <Text style={type.label}>Add questions</Text>
        <Button title="✍️ Write a question" onPress={() => setEditing("new")} />
        <Button
          title="Make questions from the catalog"
          kind="secondary"
          loading={busy === "gen"}
          onPress={() => void run("gen", async () => `Added ${(await api.modTriviaGenerate()).added} questions. Album art, artist and Guess the song ones go live; release years wait here as drafts.`)}
        />
        <Text style={[type.small, { marginTop: space.sm }]}>Draft 5 with AI (they wait here for review)</Text>
        <Segmented value={aiCat} onChange={setAiCat} options={WRITABLE} />
        <Chips value={aiGenre} options={GENRE_OPTIONS} onChange={setAiGenre} anyLabel="Any genre" />
        <Button
          title="Draft with AI"
          kind="secondary"
          loading={busy === "ai"}
          onPress={() =>
            void run("ai", async () => {
              const r = await api.modTriviaDraft(aiCat, aiGenre, 5);
              return `Drafted ${r.added}${r.skipped ? ` (${r.skipped} dropped as duplicates, malformed or quoting lyrics)` : ""}. Check every fact before approving.`;
            })
          }
        />
      </Card>

      {note ? <Text style={[type.small, { color: color.win }]}>{note}</Text> : null}
      {error ? <ErrorBanner message={error} /> : null}

      <Chips
        value={tab}
        onChange={(v) => {
          if (!v) return;
          setTab(v);
          setSelected(new Set());
        }}
        options={[
          { value: "DRAFT" as Tab, label: label("DRAFT", "Drafts") },
          { value: "FLAGGED" as Tab, label: label("FLAGGED", "Flagged") },
          { value: "APPROVED" as Tab, label: label("APPROVED", "Live") },
          { value: "REJECTED" as Tab, label: label("REJECTED", "Rejected") },
          { value: "RETIRED" as Tab, label: label("RETIRED", "Retired") },
        ]}
      />
      <Chips value={category} options={CATEGORY_FILTER} onChange={setCategory} anyLabel="All types" />
      <TextInput value={q} onChangeText={setQ} placeholder="Search questions" placeholderTextColor={color.lose} style={inputStyle} autoCorrect={false} />

      {tab === "DRAFT" && selected.size ? (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button
            title={`Approve ${selected.size}`}
            style={{ flex: 1 }}
            loading={busy === "bulk"}
            onPress={() =>
              void run("bulk", async () => {
                await api.modTriviaBulk([...selected], "APPROVED");
                setSelected(new Set());
              })
            }
          />
          <Button
            title={`Reject ${selected.size}`}
            kind="danger"
            style={{ flex: 1 }}
            loading={busy === "bulkr"}
            onPress={() =>
              void run("bulkr", async () => {
                await api.modTriviaBulk([...selected], "REJECTED");
                setSelected(new Set());
              })
            }
          />
        </View>
      ) : null}

      {list.error ? <ErrorBanner message={list.error.status === 403 ? "Moderators only." : list.error.message} onRetry={() => void list.reload()} /> : null}
      {!list.data && !list.error ? <Loading /> : null}
      {list.data && !list.data.items.length ? <EmptyState title="Nothing here" body={tab === "DRAFT" ? "No drafts waiting for review." : "No questions match."} /> : null}

      {list.data?.items.map((item) => {
        const picked = selected.has(item.id);
        return (
          <Card key={item.id} style={{ gap: space.sm, ...(picked ? { borderColor: color.violet } : {}) }}>
            <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap", alignItems: "center" }}>
              {tab === "DRAFT" ? (
                <Pressable
                  onPress={() => setSelected((s) => (s.has(item.id) ? new Set([...s].filter((x) => x !== item.id)) : new Set(s).add(item.id)))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: picked }}
                  hitSlop={8}
                >
                  <Text style={{ fontSize: 18, color: picked ? color.violet : color.muted }}>{picked ? "☑" : "☐"}</Text>
                </Pressable>
              ) : null}
              <Pill text={TRIVIA_CATEGORY_INFO[item.category].label} tone="violet" />
              {item.genre ? <Pill text={genreLabel(item.genre)} /> : null}
              <Pill text={["", "easy", "medium", "hard"][item.difficulty] ?? "medium"} />
              <Pill text={item.source.toLowerCase()} tone={item.source === "AI" ? "warn" : "default"} />
              {item.flags ? <Pill text={`${item.flags} flags`} tone="live" /> : null}
            </View>
            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: 96, height: 96, borderRadius: radius.sm }} /> : null}
            {item.hasAudio ? <Text style={type.small}>🎧 Plays the track's official preview</Text> : null}
            <Text style={type.heading}>{item.prompt}</Text>
            {item.choices.map((c, i) => (
              <Text key={i} style={[type.body, i === item.answerIndex ? { color: color.win, fontWeight: "700" } : { color: color.muted }]}>
                {i === item.answerIndex ? "✓ " : "  "}
                {c}
              </Text>
            ))}
            {item.explanation ? <Text style={type.small}>{item.explanation}</Text> : null}
            {item.flagReasons.map((f, i) => (
              <Text key={i} style={[type.small, { color: color.sideB }]}>
                ⚑ {f}
              </Text>
            ))}
            <Text style={type.small}>
              Asked {item.timesAsked}×{item.correctPct !== null ? ` · ${item.correctPct}% right` : ""}
              {item.reviewedBy ? ` · reviewed by @${item.reviewedBy}` : ""}
            </Text>
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              {item.status !== "APPROVED" || tab === "FLAGGED" ? (
                <Button title={tab === "FLAGGED" ? "Keep" : "Approve"} style={{ flexGrow: 1 }} loading={busy === `${item.id}:APPROVED`} onPress={() => void setStatus(item, "APPROVED")} />
              ) : null}
              {item.category !== "ALBUM_ART" && item.category !== "GUESS_SONG" ? (
                <Button title="Edit" kind="secondary" style={{ flexGrow: 1 }} onPress={() => setEditing(item)} />
              ) : null}
              {item.status === "DRAFT" ? (
                <Button title="Reject" kind="danger" style={{ flexGrow: 1 }} loading={busy === `${item.id}:REJECTED`} onPress={() => void setStatus(item, "REJECTED")} />
              ) : item.status !== "RETIRED" ? (
                <Button title="Retire" kind="danger" style={{ flexGrow: 1 }} loading={busy === `${item.id}:RETIRED`} onPress={() => void setStatus(item, "RETIRED")} />
              ) : null}
            </View>
          </Card>
        );
      })}

      <Modal visible={editing !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditing(null)}>
        {editing ? (
          <Editor
            item={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={(msg) => {
              setEditing(null);
              setNote(msg);
              void list.reload();
            }}
          />
        ) : null}
      </Modal>
    </ScrollView>
  );
}

const inputStyle = { backgroundColor: color.surface1, borderColor: color.line, borderWidth: 1, borderRadius: radius.md, padding: space.md, color: color.text } as const;

function Editor({ item, onClose, onSaved }: { item: TriviaAdminQuestion | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [category, setCategory] = useState<Writable>((item?.category as Writable) ?? "HISTORY");
  const [genre, setGenre] = useState<string | null>(item?.genre ?? null);
  const [difficulty, setDifficulty] = useState<"1" | "2" | "3">(String(item?.difficulty ?? 2) as "1" | "2" | "3");
  const [prompt, setPrompt] = useState(item?.prompt ?? "");
  const [choices, setChoices] = useState<string[]>(() => {
    const c = [...(item?.choices ?? [])];
    while (c.length < 4) c.push("");
    return c;
  });
  const [answer, setAnswer] = useState(item?.answerIndex ?? 0);
  const [explanation, setExplanation] = useState(item?.explanation ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    // Drop empty answers, keeping track of which one is right.
    const filled = choices.map((c, i) => ({ c: c.trim(), i })).filter((x) => x.c);
    const answerIndex = filled.findIndex((x) => x.i === answer);
    if (answerIndex < 0) {
      setBusy(false);
      return setError("Mark which answer is right.");
    }
    const body = { category, genre, difficulty: Number(difficulty), prompt, choices: filled.map((x) => x.c), answerIndex, explanation: explanation.trim() || null };
    try {
      if (item) await api.modTriviaUpdate(item.id, { ...body, ...(approve ? { status: "APPROVED" as const } : {}) });
      else await api.modTriviaCreate({ ...body, approve });
      onSaved(approve ? "Saved and live." : "Saved.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: color.ink }} contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
      <Text style={type.title}>{item ? "Edit question" : "New question"}</Text>
      <Text style={type.small}>Facts only, and check them. Name songs by title; never quote or ask for lyrics.</Text>
      <Segmented value={category} onChange={setCategory} options={WRITABLE} />
      <Chips value={genre} options={GENRE_OPTIONS} onChange={setGenre} anyLabel="No genre" />
      <Segmented
        value={difficulty}
        onChange={setDifficulty}
        options={[
          { value: "1", label: "Easy" },
          { value: "2", label: "Medium" },
          { value: "3", label: "Hard" },
        ]}
      />
      <Field label="Question" value={prompt} onChangeText={setPrompt} multiline maxLength={300} />
      <Text style={type.label}>Answers (tap ○ to mark the right one)</Text>
      {choices.map((c, i) => (
        <View key={i} style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
          <Pressable onPress={() => setAnswer(i)} accessibilityRole="radio" accessibilityState={{ checked: answer === i }} hitSlop={8}>
            <Text style={{ fontSize: 22, color: answer === i ? color.win : color.muted }}>{answer === i ? "●" : "○"}</Text>
          </Pressable>
          <TextInput
            value={c}
            onChangeText={(t) => setChoices((cs) => cs.map((x, j) => (j === i ? t : x)))}
            placeholder={`Answer ${i + 1}`}
            placeholderTextColor={color.lose}
            maxLength={120}
            style={[inputStyle, { flex: 1 }]}
          />
        </View>
      ))}
      <Field label="Why it's right (shown after answering)" value={explanation} onChangeText={setExplanation} multiline maxLength={400} />
      {error ? <ErrorBanner message={error} /> : null}
      <Button title={item?.status === "APPROVED" ? "Save" : "Save and approve"} loading={busy} onPress={() => void save(item?.status !== "APPROVED")} />
      {item?.status !== "APPROVED" ? <Button title="Save as draft" kind="secondary" disabled={busy} onPress={() => void save(false)} /> : null}
      <Button title="Cancel" kind="ghost" onPress={onClose} />
    </ScrollView>
  );
}
