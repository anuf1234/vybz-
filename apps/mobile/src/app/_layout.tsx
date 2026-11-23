import { setAudioModeAsync } from "expo-audio";
import { Stack, useRouter } from "expo-router";
import { Observe, ObserveRoot } from "expo-observe";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { CrashScreen } from "@/components/crash-screen";
import { color } from "@/components/theme";
import { restoreAppleMusic } from "@/lib/apple-music";
import { useSession } from "@/lib/auth-client";
import { registerForPush, useTappedPath } from "@/lib/push";
import { useOtaUpdates } from "@/lib/updates";

// Crash and error reporting (Expo Observe): native crashes, unhandled JS
// errors and render errors, tagged with the screen they happened on.
Observe.configure({ integrations: { "expo-router": true } });

export default function RootLayout() {
  return (
    <ObserveRoot errorBoundaryFallback={(props) => <CrashScreen {...props} />}>
      <AppStack />
    </ObserveRoot>
  );
}

function AppStack() {
  useOtaUpdates();
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  useEffect(() => {
    if (signedIn) void registerForPush().catch(() => undefined);
  }, [signedIn]);
  // Tapping a push notification opens its battle.
  const tapped = useTappedPath();
  useEffect(() => {
    if (tapped) router.push(tapped as never);
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
        <Stack.Screen name="user/[handle]/index" options={{ title: "Profile" }} />
        <Stack.Screen name="user/[handle]/follows" options={{ title: "People" }} />
        <Stack.Screen name="post/[id]" options={{ title: "Post" }} />
        <Stack.Screen name="post/new" options={{ title: "New post", presentation: "modal" }} />
        <Stack.Screen name="messages/index" options={{ title: "Messages" }} />
        <Stack.Screen name="messages/[id]" options={{ title: "Message" }} />
        <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
        <Stack.Screen name="rankings" options={{ title: "Rankings" }} />
        <Stack.Screen name="achievements" options={{ title: "Achievements" }} />
        <Stack.Screen name="wallet" options={{ title: "XP & coins" }} />
        <Stack.Screen name="shop" options={{ title: "Shop" }} />
        <Stack.Screen name="quick" options={{ title: "Quick battle", presentation: "modal" }} />
        <Stack.Screen name="challenge" options={{ title: "Battle a friend" }} />
        <Stack.Screen name="rematch/[id]" options={{ title: "Rematch" }} />
        <Stack.Screen name="leagues" options={{ title: "Leagues" }} />
        <Stack.Screen name="go-live" options={{ title: "Go live", presentation: "modal" }} />
        <Stack.Screen name="save-account" options={{ title: "Save your account", presentation: "modal" }} />
        <Stack.Screen name="playlist/[id]/index" options={{ title: "Playlist" }} />
        <Stack.Screen name="playlist/[id]/add" options={{ title: "Add songs", presentation: "modal" }} />
        <Stack.Screen name="playlist/new" options={{ title: "New playlist", presentation: "modal" }} />
        <Stack.Screen name="playlist/import" options={{ title: "Import from YouTube", presentation: "modal" }} />
        <Stack.Screen name="mod/index" options={{ title: "Moderation" }} />
        <Stack.Screen name="mod/trivia" options={{ title: "Trivia questions" }} />
        <Stack.Screen name="mod/trivia-review" options={{ title: "Review drafts" }} />
        <Stack.Screen name="welcome" options={{ title: "Welcome", presentation: "modal", gestureEnabled: false }} />
        <Stack.Screen name="trivia/index" options={{ title: "Trivia" }} />
        <Stack.Screen name="trivia/[id]" options={{ title: "Trivia", gestureEnabled: false }} />
        <Stack.Screen name="trivia/leaderboard" options={{ title: "Trivia leaderboard" }} />
        <Stack.Screen name="wars/index" options={{ title: "Album Wars" }} />
        <Stack.Screen name="wars/new" options={{ title: "Start a war", presentation: "modal" }} />
        <Stack.Screen name="wars/[id]" options={{ title: "War" }} />
        <Stack.Screen name="wars/rankings" options={{ title: "Best of" }} />
        <Stack.Screen name="drops/index" options={{ title: "Daily Drops" }} />
        <Stack.Screen name="drops/submit" options={{ title: "Share a mixtape", presentation: "modal" }} />
        <Stack.Screen name="drops/artists" options={{ title: "Artists" }} />
        <Stack.Screen name="drops/top" options={{ title: "Top charts" }} />
        <Stack.Screen name="verdict" options={{ title: "This or That" }} />
        <Stack.Screen name="ranked" options={{ title: "Ranked" }} />
        <Stack.Screen name="pro" options={{ title: "VYBZ Pro", presentation: "modal" }} />
        <Stack.Screen name="tournaments/index" options={{ title: "Tournaments" }} />
        <Stack.Screen name="tournaments/[id]" options={{ title: "Tournament" }} />
        <Stack.Screen name="tournaments/new" options={{ title: "New tournament", presentation: "modal" }} />
        <Stack.Screen name="artist/[name]" options={{ title: "Artist" }} />
        <Stack.Screen name="artist/claim" options={{ title: "Artist profile", presentation: "modal" }} />
        <Stack.Screen name="artist/challenge" options={{ title: "Challenge an artist", presentation: "modal" }} />
        <Stack.Screen name="chart/index" options={{ title: "The VYBZ Chart" }} />
        <Stack.Screen name="party/index" options={{ title: "Party Mode" }} />
        <Stack.Screen name="party/play" options={{ title: "Party" }} />
        <Stack.Screen name="dj/index" options={{ title: "DJ Vybz" }} />
        <Stack.Screen name="dj/university" options={{ title: "DJ University" }} />
        <Stack.Screen name="dj/lesson/[id]" options={{ title: "Lesson" }} />
        <Stack.Screen name="dj/studio" options={{ title: "DJ Vybz Studio" }} />
        <Stack.Screen name="dj/battles" options={{ title: "DJ battles" }} />
        <Stack.Screen name="dj/battle/[id]" options={{ title: "DJ battle" }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign in", presentation: "modal" }} />
        <Stack.Screen name="sign-up" options={{ title: "Create account", presentation: "modal" }} />
      </Stack>
    </>
  );
}
