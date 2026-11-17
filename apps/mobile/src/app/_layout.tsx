import { setAudioModeAsync } from "expo-audio";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { color } from "@/components/theme";
import { restoreAppleMusic } from "@/lib/apple-music";
import { useSession } from "@/lib/auth-client";
import { registerForPush, useTappedBattleId } from "@/lib/push";

export default function RootLayout() {
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  useEffect(() => {
    if (signedIn) void registerForPush().catch(() => undefined);
  }, [signedIn]);
  // Tapping a push notification opens its battle.
  const tapped = useTappedBattleId();
  useEffect(() => {
    if (tapped) router.push({ pathname: "/battle/[id]", params: { id: tapped } });
  }, [tapped, router]);

  useEffect(() => {
    // Battles are for listening: play even with the ringer switch off.
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
    void restoreAppleMusic();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: color.ink },
          headerTintColor: color.text,
          headerTransparent: false,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: color.ink },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="battle/[id]/index" options={{ title: "Battle" }} />
        <Stack.Screen name="battle/[id]/pick" options={{ title: "Pick your tracks", presentation: "modal" }} />
        <Stack.Screen name="battle/[id]/counter" options={{ title: "Counter-offer", presentation: "modal" }} />
        <Stack.Screen name="user/[handle]" options={{ title: "Profile" }} />
        <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
        <Stack.Screen name="rankings" options={{ title: "Rankings" }} />
        <Stack.Screen name="playlist/[id]/index" options={{ title: "Playlist" }} />
        <Stack.Screen name="playlist/[id]/add" options={{ title: "Add songs", presentation: "modal" }} />
        <Stack.Screen name="playlist/new" options={{ title: "New playlist", presentation: "modal" }} />
        <Stack.Screen name="mod/index" options={{ title: "Moderation" }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign in", presentation: "modal" }} />
        <Stack.Screen name="sign-up" options={{ title: "Create account", presentation: "modal" }} />
      </Stack>
    </>
  );
}
