import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "./api";

/**
 * Which songs you've saved, shared across screens so a save on one shows on
 * all. Search hits have no track id yet, so saves made by catalog id are
 * remembered by that id too.
 */

const trackIds = new Set<string>();
const catalogToTrack = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let loaded = false;

function emit() {
  version++;
  for (const l of listeners) l();
}

export async function refreshLibrary(): Promise<void> {
  try {
    const res = await api.library();
    trackIds.clear();
    for (const id of res.trackIds) trackIds.add(id);
    for (const item of res.items) catalogToTrack.set(item.catalogId, item.trackId);
    loaded = true;
    emit();
  } catch {
    // Signed out or offline: show nothing saved.
  }
}

export function isSaved(song: { trackId?: string; catalogId?: string }): boolean {
  const id = song.trackId ?? (song.catalogId ? catalogToTrack.get(song.catalogId) : undefined);
  return id !== undefined && trackIds.has(id);
}

export async function toggleSaved(song: { trackId?: string; catalogId?: string }): Promise<boolean> {
  const id = song.trackId ?? (song.catalogId ? catalogToTrack.get(song.catalogId) : undefined);
  if (id && trackIds.has(id)) {
    trackIds.delete(id);
    emit();
    try {
      await api.unsave(id);
    } catch (err) {
      trackIds.add(id);
      emit();
      throw err;
    }
    return false;
  }
  const res = await api.save(song.trackId ? { trackId: song.trackId } : { catalogId: song.catalogId! });
  trackIds.add(res.trackId);
  if (song.catalogId) catalogToTrack.set(song.catalogId, res.trackId);
  emit();
  return true;
}

/** Re-renders when saved songs change; loads them once when signed in. */
export function useLibraryVersion(signedIn: boolean): number {
  useEffect(() => {
    if (signedIn && !loaded) void refreshLibrary();
  }, [signedIn]);
  const subscribe = useCallback((l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return useSyncExternalStore(subscribe, () => version);
}

/** Forget everything on sign-out. */
export function clearLibrary() {
  trackIds.clear();
  catalogToTrack.clear();
  loaded = false;
  emit();
}
