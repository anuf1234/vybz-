import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** Bump when the tour changes enough that everyone should see it again. */
const VERSION = 1;
const key = (userId: string) => `vybz.tour.v${VERSION}.${userId.replace(/[^\w.-]/g, "_")}`;

/** Whether this person has seen the intro tour on this device. */
export async function tourSeen(userId: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(key(userId)) === "1";
    return (await SecureStore.getItemAsync(key(userId))) === "1";
  } catch {
    // Storage unavailable: don't keep showing it.
    return true;
  }
}

export async function markTourSeen(userId: string): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(key(userId), "1");
    else await SecureStore.setItemAsync(key(userId), "1");
  } catch {
    // Ignore.
  }
}
