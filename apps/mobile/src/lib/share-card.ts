import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { ActionSheetIOS, Alert, Platform, Share } from "react-native";
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

/** Any card (war, drop, chart, rank, tournament): `/card/<kind>/<id>?format=story`. */
export async function shareCardImage(kind: string, id: string, title = "Share"): Promise<boolean> {
  if (Platform.OS === "web" || !(await Sharing.isAvailableAsync())) return false;
  const dir = new Directory(Paths.cache, "share");
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, `vybz-${kind}-${id.replace(/[^\w-]/g, "_")}.png`);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(`${API_URL}/card/${encodeURIComponent(kind)}/${encodeURIComponent(id)}?format=story&t=${Date.now()}`, target);
  await Sharing.shareAsync(file.uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: title });
  return true;
}

/** "Share story card" or "Share link", like battles. Falls back to the link where images can't be shared. */
export function shareMenu(opts: { kind: string; id: string; message: string; url: string; title?: string }) {
  const link = () => void Share.share({ message: `${opts.message} ${opts.url}` });
  const card = () =>
    void shareCardImage(opts.kind, opts.id, opts.title)
      .then((ok) => (ok ? undefined : link()))
      .catch(() => Alert.alert("Couldn't make the card", "Try sharing the link instead."));
  if (Platform.OS === "web") return link();
  const note = "The story card is an image for Instagram, TikTok, Snapchat and Facebook stories.";
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions({ options: ["Share story card", "Share link", "Cancel"], cancelButtonIndex: 2, message: note }, (i) => (i === 0 ? card() : i === 1 ? link() : undefined));
    return;
  }
  Alert.alert(opts.title ?? "Share", note, [
    { text: "Story card", onPress: card },
    { text: "Link", onPress: link },
    { text: "Cancel", style: "cancel" },
  ]);
}
