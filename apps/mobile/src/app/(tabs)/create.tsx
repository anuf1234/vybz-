import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { DEFAULT_TERMS, type Terms, TermsForm, termsTheme, termsToRules } from "@/components/terms-form";
import { space, type } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Field, Segmented, SectionTitle } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

export default function Create() {
  const session = useSession();
  const router = useRouter();
  const [terms, setTerms] = useState<Terms>(DEFAULT_TERMS);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"open" | "direct">("open");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session.data && !session.isPending) {
    return (
      <EmptyState
        title="Sign in to start a battle"
        body="Pick a genre and era, set the rounds, and call someone out."
        action={
          <Link href="/sign-in" asChild>
            <Button title="Sign in" />
          </Link>
        }
      />
    );
  }

  const theme = termsTheme(terms);
  const finalTitle = title.trim() || (theme ? `${theme} battle` : "");

  async function submit() {
    setError(null);
    if (finalTitle.length < 3) return setError("Give your battle a title (3+ characters).");
    if (mode === "direct" && !/^[a-z0-9_]{3,20}$/i.test(handle.replace(/^@/, ""))) return setError("Enter your opponent's handle.");
    setBusy(true);
    try {
      const { id } = await api.createBattle({
        title: finalTitle,
        ...(mode === "direct" ? { opponentHandle: handle.replace(/^@/, "").toLowerCase() } : {}),
        rules: termsToRules(terms),
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
        <TermsForm value={terms} onChange={setTerms} />

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
        <Text style={type.small}>Your opponent can accept these terms or send back a counter-offer. The battle starts once you both agree.</Text>

        <Field label="Title" placeholder={finalTitle || "e.g. Nobody beats my 90s R&B"} value={title} onChangeText={setTitle} maxLength={80} />

        {error ? <ErrorBanner message={error} /> : null}
        <Button title={mode === "open" ? "Post open challenge" : "Send challenge"} onPress={() => void submit()} loading={busy} style={{ marginTop: space.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
