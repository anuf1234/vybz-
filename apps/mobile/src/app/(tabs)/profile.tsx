import { Link } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { ProfileBody } from "@/components/profile-body";
import { color, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner, Field, Loading } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { signOut, useSession } from "@/lib/auth-client";
import { useNow, useResource } from "@/lib/use-resource";

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
      <Button title="Sign out" kind="ghost" onPress={() => void signOut()} />
    </ScrollView>
  );
}
