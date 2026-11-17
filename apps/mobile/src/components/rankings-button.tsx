import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable } from "react-native";
import { color } from "./theme";

export function RankingsButton() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/rankings")} accessibilityRole="button" accessibilityLabel="Rankings" hitSlop={10} style={{ marginLeft: 16 }}>
      <Ionicons name="trophy-outline" size={22} color={color.text} />
    </Pressable>
  );
}
