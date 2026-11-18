import { Stack, useLocalSearchParams } from "expo-router";
import { StudioView } from "@/components/studio-view";

/** DJ Vybz Studio inside the app. ?path= is a /studio URL (lesson demo, practice, a set, a battle). */
export default function DjStudio() {
  const { path, title } = useLocalSearchParams<{ path?: string; title?: string }>();
  const safe = path && path.startsWith("/studio") ? path : "/studio";
  return (
    <>
      <Stack.Screen options={{ title: title ?? "DJ Vybz Studio" }} />
      <StudioView path={safe} />
    </>
  );
}
