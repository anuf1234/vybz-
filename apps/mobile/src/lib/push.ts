import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

/**
 * Phone notifications. Registers this device's Expo push token with the server
 * after sign-in. Needs a real device and an EAS project id (set by `eas init`);
 * otherwise it quietly does nothing and the in-app list still works.
 */

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

/** The battle id of the last push the user tapped (always null on web, where push isn't supported). */
export const useTappedBattleId: () => string | null =
  Platform.OS === "web"
    ? () => null
    : () => {
        const data = Notifications.useLastNotificationResponse()?.notification.request.content.data;
        return typeof data?.battleId === "string" ? data.battleId : null;
      };

let registered = false;

export async function registerForPush(): Promise<"registered" | "denied" | "unavailable"> {
  if (registered) return "registered";
  if (Platform.OS === "web" || !Device.isDevice) return "unavailable";
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return "unavailable";
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Battles", importance: Notifications.AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return "denied";
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.registerPush(token, Platform.OS);
  registered = true;
  return "registered";
}
