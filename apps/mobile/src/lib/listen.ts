import { Alert, Linking } from "react-native";
import { api } from "./api";

/** Opens a release, war side or track on a streaming service. The server logs the tap and gives the URL. */
export async function listenOn(service: "spotify" | "apple" | "youtube" | "source", kind: "release" | "war" | "track", id: string, side?: "A" | "B"): Promise<void> {
  try {
    const { url } = await api.out(service, kind, id, side);
    await Linking.openURL(url);
  } catch (err) {
    Alert.alert("Couldn't open that", err instanceof Error ? err.message : "Try again.");
  }
}
