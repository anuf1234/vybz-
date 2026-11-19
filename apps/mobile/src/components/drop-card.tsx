import { RELEASE_KINDS, type ReleaseView } from "@vybz/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "./theme";
import { Pill } from "./ui";
import { Cover } from "./war-card";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { shareMenu } from "@/lib/share-card";

const KIND_ICON = { SINGLE: "🎵", EP: "📀", ALBUM: "💿", MIXTAPE: "📼" } as const;
export const kindLabel = (k: ReleaseView["kind"]) => RELEASE_KINDS.find((x) => x.key === k)?.label ?? k;

/** One drop: cover, title, artist, 🔥, listen (links out), war, follow artist. */
export function DropCard({ drop, signedIn, onChange }: { drop: ReleaseView; signedIn: boolean; onChange?: (d: ReleaseView) => void }) {
  const router = useRouter();
  const [d, setD] = useState(drop);
  const [busy, setBusy] = useState(false);
  const update = (next: ReleaseView) => {
    setD(next);
    onChange?.(next);
  };
  const act = async (fn: () => Promise<void>) => {
    if (!signedIn) return router.push("/sign-in");
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };
  const fire = () =>
    act(async () => {
      update({ ...d, fired: !d.fired, fires: d.fires + (d.fired ? -1 : 1) });
      update(await api.fireDrop(d.id, !d.fired));
    });
  const follow = () =>
    act(async () => {
      if (d.following) await api.unfollowArtist({ name: d.artistName });
      else await api.followArtist({ releaseId: d.id });
      update({ ...d, following: !d.following });
    });
  const war = () => {
    if (d.warId) return router.push({ pathname: "/wars/[id]", params: { id: d.warId } });
    if (!d.ref) return;
    router.push({ pathname: "/wars/new", params: { kind: d.kind === "SINGLE" ? "SINGLE" : "ALBUM", ...(d.kind === "SINGLE" ? {} : { a: d.ref, aTitle: d.title }) } });
  };

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <Cover url={d.artworkUrl} size={84} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
            <Pill text={`${KIND_ICON[d.kind]} ${kindLabel(d.kind)}`} tone={d.kind === "MIXTAPE" ? "warn" : "violet"} />
            {d.status === "PENDING" ? <Pill text="In review" /> : null}
          </View>
          <Text style={[type.body, { fontWeight: "800" }]} numberOfLines={2}>
            {d.title}
          </Text>
          <Text style={type.small} numberOfLines={1}>
            {d.artistName}
            {d.releaseDate ? ` · ${d.releaseDate}` : ""}
          </Text>
          {d.submittedBy ? <Text style={type.small}>Shared by @{d.submittedBy.handle}</Text> : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
        <Action label={`🔥 ${d.fires}`} on={d.fired} onPress={fire} a11y={d.fired ? "Remove your fire" : "Fire this drop up"} />
        {d.externalUrl ? <Action label={`▶ ${d.host ?? "Listen"}`} onPress={() => void Linking.openURL(d.externalUrl!)} a11y={`Listen on ${d.host ?? "the web"}`} /> : null}
        {d.warId || (d.ref && d.kind !== "MIXTAPE") ? <Action label={d.warId ? "⚔️ In a war" : "⚔️ Start a war"} onPress={war} a11y="Album war" /> : null}
        {d.status === "LIVE" ? <Action label="↗ Share" onPress={() => shareMenu({ kind: "drop", id: d.id, title: "Share this drop", message: `🆕 ${d.title} by ${d.artistName} is out. 🔥 it on VYBZ.`, url: `${API_URL}/drop/${d.id}` })} a11y="Share this drop" /> : null}
        <Action label={d.following ? "✓ Following" : "+ Follow"} on={d.following} onPress={follow} a11y={d.following ? `Unfollow ${d.artistName}` : `Follow ${d.artistName}`} />
      </View>
    </View>
  );
}

function Action({ label, on, onPress, a11y }: { label: string; on?: boolean; onPress: () => void; a11y: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, on && styles.actionOn, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ selected: !!on }}>
      <Text style={[type.small, { color: on ? color.text : color.muted, fontWeight: "700" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  action: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2 },
  actionOn: { borderColor: color.violet, backgroundColor: color.surface3 },
});
