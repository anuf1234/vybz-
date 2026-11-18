import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { API_URL } from "./config";

/**
 * Downloads a battle's 9:16 story card and opens the share sheet with it, so
 * people can post it to Instagram or Facebook Stories, Snapchat, TikTok or
 * Messages. Returns false where image sharing isn't available (web).
 */
export async function shareStoryCard(battleId: string): Promise<boolean> {
  if (Platform.OS === "web" || !(await Sharing.isAvailableAsync())) return false;
  const dir = new Directory(Paths.cache, "share");
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, `vybz-${battleId}.png`);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(`${API_URL}/battle/${encodeURIComponent(battleId)}/story?t=${Date.now()}`, target);
  await Sharing.shareAsync(file.uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: "Share your battle" });
  return true;
}
