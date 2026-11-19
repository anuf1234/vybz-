import { ARTIST_LINKS } from "@vybz/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Share, Text } from "react-native";
import { space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Field, Loading, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

const LABEL: Record<string, string> = { instagram: "Instagram link", tiktok: "TikTok link", x: "X link", youtube: "YouTube link", website: "Website" };

/** Claim your artist profile: post the code from an official account, then a moderator verifies it. */
export default function ClaimArtist() {
  const params = useLocalSearchParams<{ name?: string }>();
  const router = useRouter();
  const mine = useResource(() => api.myArtistProfile(), []);
  const [name, setName] = useState(params.name ?? "");
  const [proofUrl, setProof] = useState("");
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = mine.data?.profile ?? null;
  const verified = p?.status === "VERIFIED";

  useEffect(() => {
    if (!p) return;
    if (!params.name) setName(p.name);
    setBio(p.bio ?? "");
    setLinks(p.links as Record<string, string>);
    if (p.proofUrl) setProof(p.proofUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(links).filter(([, v]) => v.trim()));
      await api.claimArtistProfile(verified ? { bio, links: clean } : { name: name.trim(), code: mine.data!.code, proofUrl: proofUrl.trim(), bio, links: clean });
      await mine.reload();
      if (verified) router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  };

  if (!mine.data) return mine.error ? <ErrorBanner message={mine.error.message} /> : <Loading />;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: verified ? "Your artist profile" : "Claim your artist profile" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        {p ? <Pill text={p.status === "VERIFIED" ? "✓ Verified" : p.status === "PENDING" ? "Waiting for review" : "Not verified, try again"} tone={p.status === "VERIFIED" ? "violet" : "warn"} /> : null}
        {!verified ? (
          <>
            <Text style={type.small}>Verified artists get a badge, their own page, and can challenge other artists to wars their fans vote on.</Text>
            <Card style={{ gap: space.sm }}>
              <Text style={type.label}>1. Post this code from an official account</Text>
              <Text style={[type.title, { letterSpacing: 2 }]}>{mine.data.code}</Text>
              <Text style={type.small}>Put it in a post, story highlight or bio on your official Instagram, TikTok, X or YouTube. You can remove it once you're verified.</Text>
              <Button title="Copy / share the code" kind="secondary" onPress={() => void Share.share({ message: `Verifying my VYBZ artist profile: ${mine.data!.code}` })} />
            </Card>
            <Text style={type.label}>2. Tell us who you are</Text>
            <Field label="Artist name (as on your releases)" value={name} onChangeText={setName} maxLength={100} />
            <Field label="Link to the post with the code" value={proofUrl} onChangeText={setProof} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://instagram.com/p/…" />
          </>
        ) : null}
        <Field label="Bio (optional)" value={bio} onChangeText={setBio} maxLength={500} multiline />
        {ARTIST_LINKS.map((k) => (
          <Field key={k} label={`${LABEL[k]} (optional)`} value={links[k] ?? ""} onChangeText={(v) => setLinks((l) => ({ ...l, [k]: v }))} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…" />
        ))}
        {error ? <ErrorBanner message={error} /> : null}
        <Button title={busy ? "Saving…" : verified ? "Save" : p?.status === "PENDING" ? "Update my claim" : "Send for review"} disabled={busy || (!verified && (!name.trim() || !proofUrl.trim()))} onPress={() => void submit()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
