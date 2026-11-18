import { Text, View } from "react-native";
import { space, type } from "@/components/theme";
import { Button } from "@/components/ui";
import { API_URL } from "@/lib/config";

export type StudioMessage = { type: string; [k: string]: unknown };

/** On the web, DJ Studio is a page of the VYBZ site: open it in its own tab. */
export function StudioView({ path }: { path: string; onMessage?: (m: StudioMessage) => void }) {
  return (
    <View style={{ padding: space.lg, gap: space.md }}>
      <Text style={type.body}>DJ Vybz Studio opens in its own tab.</Text>
      <Button title="Open DJ Vybz Studio" onPress={() => window.open(`${API_URL}${path}`, "_blank", "noopener")} />
    </View>
  );
}
