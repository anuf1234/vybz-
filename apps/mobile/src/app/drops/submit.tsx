import { MIXTAPE_HOSTS, mixtapeHost } from "@vybz/core";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Field } from "@/components/ui";
import { api } from "@/lib/api";

const SITES = [...new Set(MIXTAPE_HOSTS.map((h) => h.label))].join(", ");

/** Share a mixtape link. A moderator checks it, then it goes into Daily Drops. */
export default function SubmitMixtape() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [artistName, setArtist] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const linkOk = !url.trim() || !!mixtapeHost(url.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.submitMixtape({ title: title.trim(), artistName: artistName.trim(), url: url.trim(), ...(note.trim() ? { note: note.trim() } : {}) });
      setDone(r.status === "LIVE" ? "It's live in today's drops." : "Thanks! A moderator will check it, and it'll show up in Daily Drops once approved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Share a mixtape" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={type.small}>Share a link to a mixtape you love, or your own. VYBZ links out to it; we never host the audio. Links from: {SITES}.</Text>
        {done ? (
          <Card style={{ gap: space.md }}>
            <Text style={[type.body, { fontWeight: "800" }]}>📼 Submitted</Text>
            <Text style={type.small}>{done}</Text>
            <Button title="Back to Daily Drops" onPress={() => router.back()} />
          </Card>
        ) : (
          <>
            <Field label="Mixtape title" value={title} onChangeText={setTitle} maxLength={120} placeholder="e.g. Summer Tape Vol. 2" />
            <Field label="Artist" value={artistName} onChangeText={setArtist} maxLength={120} placeholder="Who made it" />
            <Field label="Link" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://soundcloud.com/…" error={linkOk ? null : "Use an https link from one of the sites above."} />
            <Field label="Anything to add? (optional)" value={note} onChangeText={setNote} maxLength={300} multiline />
            <Text style={type.small}>Only share music the artist has put out publicly. Tapes that use other people's music without permission get taken down.</Text>
            {error ? <ErrorBanner message={error} /> : null}
            <Button title={busy ? "Sending…" : "Submit for review"} disabled={busy || !title.trim() || !artistName.trim() || !url.trim() || !linkOk} onPress={() => void submit()} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
