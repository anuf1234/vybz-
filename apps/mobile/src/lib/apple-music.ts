import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { AppleMusicNativeModule } from "../../modules/apple-music";

/**
 * Apple Music full-track playback (iOS, subscribers). Connecting asks for
 * MusicKit access and checks the subscription; the result is remembered and
 * sent to the server as a playback capability so it offers full tracks.
 */

const KEY = "vybz_apple_music_full";
let full = false;
const listeners = new Set<(v: boolean) => void>();

function set(v: boolean) {
  full = v;
  for (const l of listeners) l(v);
  void (v ? SecureStore.setItemAsync(KEY, "1") : SecureStore.deleteItemAsync(KEY)).catch(() => undefined);
}

/** Can this device play the Apple Music module at all (iOS dev/production build)? */
export const appleMusicSupported = AppleMusicNativeModule !== null;

/** Synchronous, for request headers. */
export function appleMusicFullEnabled(): boolean {
  return full;
}

/** Restores the saved state and re-checks the subscription quietly. */
export async function restoreAppleMusic(): Promise<void> {
  if (!AppleMusicNativeModule) return;
  try {
    if ((await SecureStore.getItemAsync(KEY)) !== "1") return;
    full = true;
    const ok = (await AppleMusicNativeModule.authorizationStatus()) === "authorized" && (await AppleMusicNativeModule.canPlayCatalog());
    if (!ok) set(false);
  } catch {
    // keep the saved state; playback will fail gracefully if it's stale
  }
}

export type ConnectResult = "connected" | "no-subscription" | "denied" | "unsupported";

export async function connectAppleMusic(): Promise<ConnectResult> {
  if (!AppleMusicNativeModule) return "unsupported";
  const status = await AppleMusicNativeModule.authorize();
  if (status !== "authorized") return "denied";
  if (!(await AppleMusicNativeModule.canPlayCatalog())) {
    set(false);
    return "no-subscription";
  }
  set(true);
  return "connected";
}

export function disconnectAppleMusic() {
  set(false);
}

export function useAppleMusicFull(): boolean {
  const [v, setV] = useState(full);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

/** For "Count my plays": asks for Apple Music access if needed, then a Music User Token for VYBZ's server. */
export async function appleMusicUserToken(developerToken: string): Promise<string | "denied" | "unsupported"> {
  if (!AppleMusicNativeModule) return "unsupported";
  const status = (await AppleMusicNativeModule.authorizationStatus()) === "authorized" ? "authorized" : await AppleMusicNativeModule.authorize();
  if (status !== "authorized") return "denied";
  return AppleMusicNativeModule.userToken(developerToken);
}
