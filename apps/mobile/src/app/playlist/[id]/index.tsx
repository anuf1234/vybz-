import { Ionicons } from "@expo/vector-icons";
import { type PlaylistTrackView, type PlaylistView, themeLabel } from "@vybz/core";
import { Link, Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Platform, Pressable, RefreshControl, Share, StyleSheet, Text, View } from "react-native";
import { Mosaic } from "@/components/playlist-card";
import { usePreviewPlayer } from "@/components/preview-player";
import { SaveButton } from "@/components/save-button";
import { SongRow } from "@/components/song-row";
import { color, radius, space, type } from "@/components/theme";
import { Avatar, Button, Card, EmptyState, ErrorBanner, Field, Loading, Segmented } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { API_URL } from "@/lib/config";
import { useResource } from "@/lib/use-resource";

export default function PlaylistScreen() {
  const { id, code } = useLocalSearchParams<{ id: string; code?: string }>();
  const router = useRouter();
  const session = useSession();
  const me = session.data?.user.id ?? null;
  const pl = useResource(() => api.playlist(id, code), [id, code, me]);
  const preview = usePreviewPlayer();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void pl.reload();
      return preview.stop;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]),
  );

  const p = pl.data;
  if (!p) {
    return pl.error ? (
      <View style={{ padding: space.lg }}>
        <ErrorBanner message={pl.error.status === 404 ? "This playlist doesn't exist or is private." : pl.error.message} onRetry={() => void pl.reload()} />
      </View>
    ) : (
      <Loading />
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await pl.reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That didn't work.");
    }
  };

  const move = (index: number, by: -1 | 1) => {
    const ids = p.tracks.map((t) => t.trackId);
    const j = index + by;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    // Show the new order right away; the server confirms.
    pl.setData({ ...p, tracks: ids.map((tid, i) => ({ ...p.tracks.find((t) => t.trackId === tid)!, position: i })) });
    void run(() => api.reorderPlaylist(p.id, ids));
  };

  const share = () => {
    const link = `${API_URL}/playlist/${p.id}${p.visibility === "PRIVATE" && p.shareCode ? `?code=${p.shareCode}` : ""}`;
    void Share.share({ message: `"${p.title}" on VYBZ: ${p.trackCount} songs. ${link}` });
  };

  const confirmDelete = () => {
    const doIt = () => void api.deletePlaylist(p.id).then(() => router.back(), (err) => setError(err instanceof ApiRequestError ? err.message : "Couldn't delete it."));
    if (Platform.OS === "web") return doIt();
    Alert.alert("Delete this playlist?", "Its songs stay in your library if you saved them. This can't be undone.", [
      { text: "Keep", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doIt },
    ]);
  };

  const theme = themeLabel({ genres: p.genres, eraFrom: p.eraFrom ?? undefined, eraTo: p.eraTo ?? undefined });

  return (
    <FlatList
      data={p.tracks}
      keyExtractor={(t) => t.trackId}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 60 }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={pl.refreshing} onRefresh={() => void pl.reload()} />}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.sm }}>
          <Stack.Screen options={{ title: p.title }} />
          <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
            <Mosaic urls={p.artworkUrls} size={96} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={type.title} numberOfLines={2}>
                {p.title}
              </Text>
              <Text style={type.small}>
                @{p.owner.handle} · {p.trackCount} {p.trackCount === 1 ? "song" : "songs"}
                {p.visibility === "PRIVATE" ? " · Private" : ""}
              </Text>
              {theme ? <Text style={type.small}>{theme}</Text> : null}
            </View>
          </View>
          {p.description ? <Text style={type.body}>{p.description}</Text> : null}
          {error ? <ErrorBanner message={error} /> : null}

          {p.viewer.canEdit ? (
            <View style={styles.actions}>
              <Link href={{ pathname: "/playlist/[id]/add", params: { id: p.id } }} asChild>
                <Button title="Add songs" style={{ flex: 1 }} />
              </Link>
              <Button title="Share" kind="secondary" style={{ flex: 1 }} onPress={share} />
            </View>
          ) : p.visibility === "PUBLIC" ? (
            <Button title="Share" kind="secondary" onPress={share} />
          ) : null}
          {p.visibility === "PUBLIC" && me ? (
            <Link href={{ pathname: "/post/new", params: { playlistId: p.id, label: p.title } }} asChild>
              <Button title="Share to feed" kind="ghost" />
            </Link>
          ) : null}
          {p.viewer.isOwner ? (
            editing ? (
              <EditCard p={p} onDone={() => setEditing(false)} run={run} onDelete={confirmDelete} />
            ) : (
              <Button title="Edit details and collaborators" kind="ghost" onPress={() => setEditing(true)} />
            )
          ) : p.viewer.canEdit && me ? (
            <Text style={type.small}>You can add, remove and reorder songs in this playlist.</Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          title="No songs yet"
          body={p.viewer.canEdit ? "Add songs from search or your saved songs." : "The owner hasn't added songs yet."}
        />
      }
      renderItem={({ item, index }) => (
        <TrackRow
          item={item}
          index={index}
          last={index === p.tracks.length - 1}
          canEdit={p.viewer.canEdit}
          playing={preview.currentId === item.catalogId}
          onPreview={() => preview.toggle(item)}
          onMove={(by) => move(index, by)}
          onRemove={() => void run(() => api.removeFromPlaylist(p.id, item.trackId))}
          showAddedBy={p.collaborators.length > 0}
        />
      )}
    />
  );
}

function TrackRow({
  item,
  index,
  last,
  canEdit,
  playing,
  onPreview,
  onMove,
  onRemove,
  showAddedBy,
}: {
  item: PlaylistTrackView;
  index: number;
  last: boolean;
  canEdit: boolean;
  playing: boolean;
  onPreview: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  showAddedBy: boolean;
}) {
  return (
    <View style={{ gap: 4 }}>
      <SongRow
        hit={item}
        rank={index + 1}
        playing={playing}
        onPreview={onPreview}
        note={showAddedBy && item.addedBy ? `Added by @${item.addedBy.handle}` : null}
        right={<SaveButton song={item} />}
      />
      {canEdit ? (
        <View style={styles.editRow}>
          <IconButton icon="arrow-up" label={`Move ${item.title} up`} disabled={index === 0} onPress={() => onMove(-1)} />
          <IconButton icon="arrow-down" label={`Move ${item.title} down`} disabled={last} onPress={() => onMove(1)} />
          <IconButton icon="close" label={`Remove ${item.title}`} onPress={onRemove} danger />
        </View>
      ) : null}
    </View>
  );
}

function IconButton({ icon, label, onPress, disabled, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={[styles.icon, disabled && { opacity: 0.3 }]}>
      <Ionicons name={icon} size={16} color={danger ? color.danger : color.text} />
    </Pressable>
  );
}

function EditCard({ p, onDone, run, onDelete }: { p: PlaylistView; onDone: () => void; run: (fn: () => Promise<unknown>) => Promise<void>; onDelete: () => void }) {
  const [title, setTitle] = useState(p.title);
  const [description, setDescription] = useState(p.description ?? "");
  const [visibility, setVisibility] = useState(p.visibility);
  const [handle, setHandle] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await run(() => api.updatePlaylist(p.id, { title: title.trim() || p.title, description: description.trim() || null, visibility }));
    setSaving(false);
    onDone();
  };

  return (
    <Card>
      <Field label="Name" value={title} onChangeText={setTitle} maxLength={80} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={500} multiline />
      <Segmented
        value={visibility}
        onChange={setVisibility}
        options={[
          { value: "PRIVATE", label: "Private · link only" },
          { value: "PUBLIC", label: "Public" },
        ]}
      />
      <Button title="Save" onPress={() => void save()} loading={saving} />

      <Text style={[type.label, { marginTop: space.md }]}>Collaborators</Text>
      <Text style={type.small}>They can add, remove and reorder songs.</Text>
      {p.collaborators.map((c) => (
        <View key={c.id} style={styles.person}>
          <Avatar name={c.displayName} image={c.image} size={28} />
          <Text style={[type.body, { flex: 1 }]}>@{c.handle}</Text>
          <Pressable onPress={() => void run(() => api.removeCollaborator(p.id, c.id))} accessibilityRole="button" accessibilityLabel={`Remove @${c.handle}`} hitSlop={8}>
            <Text style={[type.small, { color: color.danger }]}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <Field label="Add by handle" placeholder="@friend" autoCapitalize="none" autoCorrect={false} value={handle} onChangeText={setHandle} />
        </View>
        <Button
          title="Add"
          kind="secondary"
          disabled={!handle.trim()}
          onPress={() =>
            void run(async () => {
              await api.addCollaborator(p.id, handle.trim());
              setHandle("");
            })
          }
        />
      </View>

      <Button title="Done" kind="ghost" onPress={onDone} />
      <Button title="Delete playlist" kind="danger" onPress={onDelete} />
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: space.sm },
  editRow: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm, paddingRight: space.xs },
  icon: { width: 30, height: 30, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, alignItems: "center", justifyContent: "center" },
  person: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
