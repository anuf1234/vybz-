import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, ErrorBanner } from "@/components/ui";
import { signIn } from "@/lib/auth-client";
import { useServerConfig } from "@/lib/config";

type Provider = "google" | "facebook" | "tiktok";
const LABEL: Record<Provider, string> = { google: "Google", facebook: "Facebook", tiktok: "TikTok" };

/**
 * "Continue with…" buttons. Each only shows when the server says that
 * provider is set up. Apple uses the native sheet on iOS (an ID token, no
 * browser); the others open the provider's page and come back to the app.
 */
export function SocialSignIn() {
  const router = useRouter();
  const config = useServerConfig();
  const [error, setError] = useState<string | null>(null);
  const [appleReady, setAppleReady] = useState(false);
  const enabled = config?.signIn;

  useEffect(() => {
    // Needs the Sign in with Apple entitlement (ios.usesAppleSignIn in app.json).
    if (Platform.OS !== "ios" || !enabled?.apple || !Constants.expoConfig?.ios?.usesAppleSignIn) return;
    void AppleAuthentication.isAvailableAsync().then(setAppleReady, () => setAppleReady(false));
  }, [enabled?.apple]);

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  async function social(provider: Provider) {
    setError(null);
    const res = await signIn.social({ provider, callbackURL: "/" });
    if (res.error) setError(`${LABEL[provider]} sign-in isn't available right now.`);
    else done();
  }

  async function apple() {
    setError(null);
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      if (!cred.identityToken) throw new Error("no token");
      const res = await signIn.social({ provider: "apple", idToken: { token: cred.identityToken } });
      if (res.error) setError("Apple sign-in didn't work. Try again.");
      else done();
    } catch (err) {
      if ((err as { code?: string }).code === "ERR_REQUEST_CANCELED") return;
      setError("Apple sign-in didn't work. Try again.");
    }
  }

  const providers = (["google", "facebook", "tiktok"] as const).filter((p) => enabled?.[p]);
  if (!appleReady && providers.length === 0) return null;

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginVertical: space.xs }}>
        <View style={{ flex: 1, height: 1, backgroundColor: color.line }} />
        <Text style={type.small}>or</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: color.line }} />
      </View>
      {appleReady ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={radius.md}
          style={{ height: 48 }}
          onPress={() => void apple()}
        />
      ) : null}
      {providers.map((p) => (
        <Button key={p} title={`Continue with ${LABEL[p]}`} kind="secondary" onPress={() => void social(p)} />
      ))}
      {error ? <ErrorBanner message={error} /> : null}
    </View>
  );
}
