import { Observe } from "expo-observe";
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { AppState } from "react-native";

const CHECK_EVERY_MS = 30 * 60 * 1000;
let lastCheck = 0;
let ready = false;

/** Downloads a newer JS bundle if one was published to this build's channel. */
async function fetchIfNewer() {
  if (!Updates.isEnabled || __DEV__ || ready) return;
  if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const res = await Updates.fetchUpdateAsync();
    ready = res.isNew;
  } catch (err) {
    // Offline or the update server is unreachable: try again later.
    Observe.reportError(err);
  }
}

/**
 * Over-the-air updates. expo-updates already checks on every cold start; this
 * also checks when the app comes back to the foreground, and swaps in a
 * downloaded update the next time the app goes to the background, so nobody
 * gets reloaded mid-battle.
 */
export function useOtaUpdates() {
  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    void fetchIfNewer();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void fetchIfNewer();
      else if (state === "background" && ready) void Updates.reloadAsync().catch(() => undefined);
    });
    return () => sub.remove();
  }, []);
}
