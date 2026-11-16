import { HandleSchema } from "@vybz/core";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Field } from "@/components/ui";
import { signUp } from "@/lib/auth-client";

export default function SignUp() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleCheck = handle ? HandleSchema.safeParse(handle.replace(/^@/, "")) : null;
  const handleError = handleCheck && !handleCheck.success ? (handleCheck.error.issues[0]?.message ?? "Invalid handle") : null;

  async function submit() {
    if (password.length < 10) return setError("Use at least 10 characters for your password.");
    if (handleError) return;
    setBusy(true);
    setError(null);
    const res = await signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
      ...(handleCheck?.success ? { handle: handleCheck.data } : {}),
    } as Parameters<typeof signUp.email>[0]);
    setBusy(false);
    if (res.error) {
      setError(res.error.status === 422 ? "That email or handle is already taken." : res.error.message || "Couldn't create your account.");
      return;
    }
    // When verification is required there's no session yet.
    if (!res.data?.token) return setSent(true);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  if (sent) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <Card>
          <Text style={type.heading}>Check your email</Text>
          <Text style={type.body}>We sent a link to {email}. Open it on this phone to finish signing up.</Text>
        </Card>
        <Link href="/sign-in" replace asChild>
          <Button title="I've verified — sign in" />
        </Link>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text style={type.title}>Join VYBZ</Text>
        <Field label="Name" value={name} onChangeText={setName} autoComplete="name" maxLength={40} />
        <Field label="Handle (optional)" placeholder="@yourname" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} maxLength={21} error={handleError} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
        <Text style={type.small}>You must be 13 or older (16 in the EU and UK) to use VYBZ.</Text>
        {error ? <ErrorBanner message={error} /> : null}
        <Button title="Create account" onPress={() => void submit()} loading={busy} disabled={!name || !email || !password} />
        <Link href="/sign-in" replace asChild>
          <Button title="Already have an account? Sign in" kind="ghost" />
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
