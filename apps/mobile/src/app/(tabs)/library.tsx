import type { PlaylistSummary } from "@vybz/core";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { PlaylistCard } from "@/components/playlist-card";
import { usePreviewPlayer } from "@/components/preview-player";
import { SaveButton } from "@/components/save-button";
import { SongRow } from "@/components/song-row";
import { color, space } from "@/components/theme";
import { Button, EmptyState, ErrorBanner, Loading, SectionTitle, Segmented } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useResource } from "@/lib/use-resource";

type Tab = "playlists" | "saved" | "discover";

/** Your playlists, your saved songs, and public playlists to discover. */
export default function Library() {
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);
  const [tab, setTab] = useState<Tab>("playlists");
  const mine = useResource(signedIn ? () => api.playlists("mine") : null, [signedIn]);
  const saved = useResource(signedIn && tab === "saved" ? () => api.library() : null, [signedIn, tab]);
  const discover = useResource(tab === "discover" ? () => api.playlists("public") : null, [tab]);
  const preview = usePreviewPlayer();

  // Come back to fresh lists after editing a playlist.
  useFocusEffect(
    useCallback(() => {
      if (signedIn) void mine.reload();
      return preview.stop;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signedIn]),
  );

  if (!signedIn && tab !== "discover") {
    return (
      <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
        <Segmented value={tab} onChange={setTab} options={OPTIONS} />
        <EmptyState
          title="Your music, saved"
          body="Sign in to save songs from battles and searches, and build playlists to pick from."
          action={
            <Link href="/sign-in" asChild>
              <Button title="Sign in" />
            </Link>
          }
        />
      </View>
    );
  }

  const open = (p: PlaylistSummary) => router.push({ pathname: "/playlist/[id]", params: { id: p.id } });
  const playlistList = tab === "playlists" ? mine : discover;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: space.lg, paddingBottom: 0, gap: space.md }}>
        <Segmented value={tab} onChange={setTab} options={OPTIONS} />
      </View>
      {tab === "saved" ? (
        <FlatList
          data={saved.data?.items ?? []}
          keyExtractor={(i) => i.trackId}
          contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }}
          refreshControl={<RefreshControl tintColor={color.violet} refreshing={saved.refreshing} onRefresh={() => void saved.reload()} />}
          ListHeaderComponent={saved.error ? <ErrorBanner message={saved.error.message} onRetry={() => void saved.reload()} /> : undefined}
          ListEmptyComponent={
            saved.loading && !saved.data ? <Loading /> : <EmptyState title="No saved songs yet" body="Tap the bookmark on any song in a battle or search to keep it here." />
          }
          renderItem={({ item }) => (
            <SongRow
              hit={item}
              playing={preview.currentId === item.catalogId}
              onPreview={() => preview.toggle(item)}
              right={<SaveButton song={item} />}
            />
          )}
        />
      ) : (
        <FlatList
          data={playlistList.data?.items ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }}
          refreshControl={<RefreshControl tintColor={color.violet} refreshing={playlistList.refreshing} onRefresh={() => void playlistList.reload()} />}
          ListHeaderComponent={
            <View style={{ gap: space.sm, marginBottom: space.sm }}>
              {playlistList.error ? <ErrorBanner message={playlistList.error.message} onRetry={() => void playlistList.reload()} /> : null}
              {tab === "playlists" ? (
                <>
                  <Link href="/playlist/new" asChild>
                    <Button title="New playlist" />
                  </Link>
                  <Link href={{ pathname: "/playlist/new", params: { generate: "1" } }} asChild>
                    <Button title="Generate one for a genre and era" kind="secondary" />
                  </Link>
                  {mine.data?.items.length ? <SectionTitle>Your playlists</SectionTitle> : null}
                </>
              ) : (
                <SectionTitle>Public playlists</SectionTitle>
              )}
            </View>
          }
          ListEmptyComponent={
            playlistList.loading && !playlistList.data ? (
              <Loading />
            ) : tab === "playlists" ? (
              <EmptyState title="No playlists yet" body="Make one by hand, or let VYBZ fill one for a genre and era." />
            ) : (
              <EmptyState title="Nothing public yet" body="Public playlists from everyone show up here." />
            )
          }
          renderItem={({ item }) => <PlaylistCard p={item} onPress={() => open(item)} showOwner={tab === "discover" || item.owner.id !== session.data?.user.id} />}
        />
      )}
    </View>
  );
}

const OPTIONS: { value: Tab; label: string }[] = [
  { value: "playlists", label: "Playlists" },
  { value: "saved", label: "Saved" },
  { value: "discover", label: "Discover" },
];
