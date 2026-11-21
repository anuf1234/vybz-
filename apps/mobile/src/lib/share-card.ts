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

/** The result card for a finished battle, drawn from `as`'s side. */
export function resultCardUrl(battleId: string, as: string | null, code: string | null, format: "story" | "wide" = "story"): string {
  const q = new URLSearchParams({ format });
  if (as) q.set("as", as);
  if (code) q.set("code", code);
  return `${API_URL}/card/result/${encodeURIComponent(battleId)}?${q}`;
}

/** The link in a shared result: opens a page (and the app) that challenges whoever shared it. */
export function resultLink(battleId: string, by: string | null, code: string | null): string {
  const q = new URLSearchParams();
  if (by) q.set("by", by);
  if (code) q.set("code", code);
  const qs = q.toString();
  return `${API_URL}/r/${encodeURIComponent(battleId)}${qs ? `?${qs}` : ""}`;
}

/**
 * Shares a battle result: the card image plus the bragging line and the
 * rematch link. iOS sends both together (Messages, WhatsApp, Instagram DMs);
 * elsewhere people choose the card (for stories) or the message with the link.
 */
export async function shareResult(opts: { battleId: string; as: string | null; code: string | null; message: string }): Promise<void> {
  const link = resultLink(opts.battleId, opts.as, opts.code);
  const text = `${opts.message} ${link}`;
  if (Platform.OS === "web") {
    await Share.share({ message: text });
    return;
  }
  const download = async () => {
    const dir = new Directory(Paths.cache, "share");
    if (!dir.exists) dir.create({ intermediates: true });
    const target = new File(dir, `vybz-result-${opts.battleId}.png`);
    if (target.exists) target.delete();
    return File.downloadFileAsync(`${resultCardUrl(opts.battleId, opts.as, opts.code)}&t=${Date.now()}`, target);
  };
  if (Platform.OS === "ios") {
    try {
      const file = await download();
      await Share.share({ message: text, url: file.uri });
    } catch {
      await Share.share({ message: text });
    }
    return;
  }
  Alert.alert("Share your result", "The card is an image for stories. The message has the rematch link.", [
    {
      text: "Card",
      onPress: () =>
        void download()
          .then((file) => Sharing.shareAsync(file.uri, { mimeType: "image/png", dialogTitle: "Share your result" }))
          .catch(() => Share.share({ message: text })),
    },
    { text: "Message", onPress: () => void Share.share({ message: text }) },
    { text: "Cancel", style: "cancel" },
  ]);
}
