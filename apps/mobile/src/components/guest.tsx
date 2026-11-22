import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { playAsGuest, useSession } from "@/lib/auth-client";
import { color, radius, space, type } from "./theme";
import { Button } from "./ui";

/** True while signed in as a guest. */
export function useIsGuest(): boolean {
  const session = useSession();
  return Boolean((session.data?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous);
}

/**
 * For someone opening a friend's challenge without an account: play right
 * now as a guest, or sign in. `onGuest` runs once the guest session exists.
 */
export function GuestOrSignIn({ action, onGuest }: { action: string; onGuest?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await playAsGuest();
      onGuest?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a guest session.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.sm, alignSelf: "stretch" }}>
      <Button title={`${action} as a guest`} onPress={() => void go()} loading={busy} />
      <Text style={[type.small, { textAlign: "center" }]}>No sign-up needed. Save your account after the battle to keep it.</Text>
      <Link href="/sign-in" asChild>
        <Button title="I have an account" kind="ghost" />
      </Link>
      {error ? <Text style={[type.small, { color: color.danger, textAlign: "center" }]}>{error}</Text> : null}
    </View>
  );
}

/** Shown to guests: keep your battles by saving the account. */
export function SaveAccountBanner({ note }: { note?: string }) {
  const router = useRouter();
  if (!useIsGuest()) return null;
  return (
    <Pressable onPress={() => router.push("/save-account")} accessibilityRole="button" style={({ pressed }) => [styles.banner, pressed && { opacity: 0.85 }]}>
      <Text style={[type.body, { fontWeight: "800" }]}>You're playing as a guest</Text>
      <Text style={type.small}>{note ?? "Save your account to keep your battles, vote, post and start your own challenges."}</Text>
      <Text style={{ color: color.violetSoft, fontWeight: "800" }}>Save my account ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { gap: 4, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.violet, backgroundColor: color.surface2 },
});
