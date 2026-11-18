import { useLocalSearchParams } from "expo-router";
import { StudioView } from "@/components/studio-view";

/** A DJ battle: hear both sets in the studio, then vote (or take it on). */
export default function DjBattle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StudioView path={`/studio?djbattle=${encodeURIComponent(id)}`} />;
}
