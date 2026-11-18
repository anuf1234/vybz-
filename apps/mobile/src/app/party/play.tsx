import { Stack, useLocalSearchParams } from "expo-router";
import { StudioView } from "@/components/studio-view";

/** A party page (player or host) in the app, signed in so members earn XP. */
export default function PartyPlay() {
  const { path, title } = useLocalSearchParams<{ path?: string; title?: string }>();
  const safe = path && (path.startsWith("/p/") || path === "/party") ? path : "/p";
  return (
    <>
      <Stack.Screen options={{ title: title ?? "Party" }} />
      <StudioView path={safe} />
    </>
  );
}
