import { Link } from "expo-router";
import { useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { ProfileBody } from "@/components/profile-body";
import { color, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner, Field, Loading } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { signOut, useSession } from "@/lib/auth-client";
import { clearLibrary } from "@/lib/library-store";
import { useNow, useResource } from "@/lib/use-resource";
import { appleMusicSupported, connectAppleMusic, disconnectAppleMusic, useAppleMusicFull } from "@/lib/apple-music";
import { API_URL, useServerConfig } from "@/lib/config";

export default function Profile() {
  const session = useSession();
  const signedIn = Boolean(session.data);
  const me = useResource(signedIn ? () => api.me() : null, [signedIn]);
  const prof = useResource(me.data ? () => api.profile(me.data!.handle) : null, [me.data?.handle]);
  const now = useNow(5000);
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.isPending) return <Loading />;
  if (!signedIn) {
    return (
      <EmptyState
        title="Your VYBZ profile"
        body="Sign in to battle, vote and climb the rankings."
        action={
          <View style={{ gap: space.sm, alignSelf: "stretch" }}>
            <Link href="/sign-in" asChild>
              <Button title="Sign in" />
            </Link>
            <Link href="/sign-up" asChild>
              <Button title="Create account" kind="secondary" />
            </Link>
          </View>
        }
      />
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateMe({
        ...(handle && handle !== me.data?.handle ? { handle: handle.replace(/^@/, "").toLowerCase() } : {}),
        ...(name && name !== me.data?.displayName ? { displayName: name } : {}),
      });
      me.setData(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={prof.refreshing} onRefresh={() => void Promise.all([me.reload(), prof.reload()])} />}
    >
      {me.error ? <ErrorBanner message={me.error.message} onRetry={() => void me.reload()} /> : null}
      {me.data && !me.data.emailVerified ? (
        <Card style={{ borderColor: color.sideB }}>
          <Text style={type.body}>Check {me.data.email} for a link to verify your email. You'll need it to battle and vote.</Text>
        </Card>
      ) : null}
      {prof.data ? <ProfileBody profile={prof.data} now={now} /> : <Loading />}

      {editing ? (
        <Card>
          <Field label="Display name" defaultValue={me.data?.displayName} onChangeText={setName} maxLength={40} />
          <Field label="Handle" defaultValue={me.data?.handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} maxLength={21} />
          {error ? <ErrorBanner message={error} /> : null}
          <Button title="Save" onPress={() => void save()} loading={saving} />
          <Button title="Cancel" kind="ghost" onPress={() => setEditing(false)} />
        </Card>
      ) : (
        <Button title="Edit profile" kind="secondary" onPress={() => setEditing(true)} />
      )}
      <MusicServices />
      <Link href="/notifications" asChild>
        <Button title="Notifications" kind="secondary" />
      </Link>
      {me.data && (me.data.role === "MODERATOR" || me.data.role === "ADMIN") ? (
        <Link href="/mod" asChild>
          <Button title="Moderation queue" kind="secondary" />
        </Link>
      ) : null}
      <Link href="/wallet" asChild>
        <Button title="XP & coins" kind="secondary" />
      </Link>
      <Link href="/shop" asChild>
        <Button title="Shop" kind="secondary" />
      </Link>
      <Link href="/achievements" asChild>
        <Button title="Achievements" kind="secondary" />
      </Link>
      <Link href="/rankings" asChild>
        <Button title="Rankings" kind="secondary" />
      </Link>
      <Button
        title="Sign out"
        kind="ghost"
        onPress={() => {
          clearLibrary();
          void signOut();
        }}
      />
      <AccountFooter />
    </ScrollView>
  );
}

/** Legal links and account deletion (App Store rule: deletion must be in the app). */
function AccountFooter() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = (path: string) => void WebBrowser.openBrowserAsync(`${API_URL}${path}`);

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      clearLibrary();
      await signOut();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't delete your account. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = () =>
    Alert.alert("Delete your account?", "This removes your profile, posts, comments, messages, playlists and battle history. It can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete account", style: "destructive", onPress: () => void doDelete() },
    ]);

  return (
    <View style={{ gap: space.sm, marginTop: space.lg }}>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: space.lg }}>
        <Text style={[type.small, { color: color.violet }]} onPress={() => open("/privacy")} accessibilityRole="link">
          Privacy
        </Text>
        <Text style={[type.small, { color: color.violet }]} onPress={() => open("/terms")} accessibilityRole="link">
          Terms
        </Text>
      </View>
      {error ? <ErrorBanner message={error} /> : null}
      <Button title="Delete account" kind="ghost" onPress={confirm} loading={busy} />
    </View>
  );
}

/** Which services battles can play on, and connecting Apple Music for full tracks. */
function MusicServices() {
  const config = useServerConfig();
  const appleFull = useAppleMusicFull();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!config || (!config.playback.appleMusic && !config.playback.youtube)) return null;

  async function connect() {
    setBusy(true);
    setNote(null);
    const r = await connectAppleMusic().catch(() => "denied" as const);
    setBusy(false);
    setNote(
      r === "connected"
        ? "Connected. Battles can play full songs on Apple Music."
        : r === "no-subscription"
          ? "Apple Music is connected, but full songs need an active Apple Music subscription. You'll get 30-second previews."
          : r === "denied"
            ? "Apple Music access wasn't allowed. You can turn it on in Settings › Privacy › Media & Apple Music."
            : "Apple Music full tracks need the VYBZ iPhone app.",
    );
  }

  return (
    <Card>
      <Text style={type.heading}>Music services</Text>
      {config.playback.youtube ? (
        <View style={{ gap: 2 }}>
          <Text style={[type.body, { fontWeight: "700" }]}>YouTube</Text>
          <Text style={type.small}>Full songs in YouTube's player. No account needed.</Text>
        </View>
      ) : null}
      {config.playback.appleMusic ? (
        <View style={{ gap: space.sm }}>
          <View style={{ gap: 2 }}>
            <Text style={[type.body, { fontWeight: "700" }]}>Apple Music</Text>
            <Text style={type.small}>
              {appleFull ? "Connected: full songs with your subscription." : "30-second previews for everyone. Subscribers can connect for full songs."}
            </Text>
          </View>
          {appleMusicSupported ? (
            appleFull ? (
              <Button title="Disconnect Apple Music" kind="ghost" onPress={disconnectAppleMusic} />
            ) : (
              <Button title="Connect Apple Music" kind="secondary" loading={busy} onPress={() => void connect()} />
            )
          ) : (
            <Text style={type.small}>Full Apple Music tracks are available in the VYBZ iPhone app.</Text>
          )}
          {note ? <Text style={type.small}>{note}</Text> : null}
        </View>
      ) : null}
      <Text style={type.small}>In a battle, pick "Listen on" to choose the service. Both sides always play on the same one.</Text>
    </Card>
  );
}
