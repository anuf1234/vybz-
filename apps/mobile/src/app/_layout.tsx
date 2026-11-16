import { setAudioModeAsync } from "expo-audio";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { color } from "@/components/theme";

export default function RootLayout() {
  useEffect(() => {
    // Battles are for listening: play even with the ringer switch off.
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
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
        <Stack.Screen name="battle/[id]/pick" options={{ title: "Pick your track", presentation: "modal" }} />
        <Stack.Screen name="user/[handle]" options={{ title: "Profile" }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign in", presentation: "modal" }} />
        <Stack.Screen name="sign-up" options={{ title: "Create account", presentation: "modal" }} />
      </Stack>
    </>
  );
}
