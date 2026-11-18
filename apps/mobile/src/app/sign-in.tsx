import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { space, type } from "@/components/theme";
import { SocialSignIn } from "@/components/social-sign-in";
import { Button, ErrorBanner, Field } from "@/components/ui";
import { signIn } from "@/lib/auth-client";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (res.error) {
      setError(res.error.status === 403 ? "Verify your email first. Check your inbox for the link." : res.error.message || "Wrong email or password.");
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text style={type.title}>Welcome back</Text>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={() => void submit()} />
        {error ? <ErrorBanner message={error} /> : null}
        <Button title="Sign in" onPress={() => void submit()} loading={busy} disabled={!email || !password} />
        <SocialSignIn />
        <Link href="/sign-up" replace asChild>
          <Button title="New here? Create an account" kind="ghost" />
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
