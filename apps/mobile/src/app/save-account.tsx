import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { useIsGuest } from "@/components/guest";
import { SocialSignIn } from "@/components/social-sign-in";
import { space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Field } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

/**
 * Guests keep everything by saving the account: with email and a password
 * (same account, nothing moves), or by continuing with Apple or Google
 * (their battles move to that account).
 */
export default function SaveAccount() {
  const router = useRouter();
  const session = useSession();
  const guest = useIsGuest();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (password.length < 10) return setError("Use at least 10 characters for your password.");
    setBusy(true);
    setError(null);
    try {
      await api.saveAccount({ email: email.trim(), password, ...(name.trim() ? { displayName: name.trim() } : {}) });
      await session.refetch();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save your account.");
    } finally {
      setBusy(false);
    }
  };

  if (saved || (!guest && session.data)) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <Card>
          <Text style={type.heading}>Your account is saved</Text>
          <Text style={type.body}>{saved ? `We sent a link to ${email}. Open it to confirm your email; then you can vote and post too.` : "You're all set."}</Text>
        </Card>
        <Button title="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text style={type.title}>Save your account</Text>
        <Text style={type.small}>Keep your battles and handle, and unlock voting, posting and starting your own challenges.</Text>
        <SocialSignIn />
        <Field label="Name" value={name} onChangeText={setName} autoComplete="name" maxLength={40} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
        {error ? <ErrorBanner message={error} /> : null}
        <Button title="Save with email" onPress={() => void save()} loading={busy} disabled={!email || !password} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
