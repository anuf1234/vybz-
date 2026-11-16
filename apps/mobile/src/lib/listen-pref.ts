import type { ProviderKind } from "@vybz/providers";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

/** The listener's preferred service ("Listen on"), remembered across battles. */

const KEY = "vybz_listen_on";
let preferred: ProviderKind | null = null;
let loaded = false;
const listeners = new Set<(p: ProviderKind | null) => void>();

export function setPreferredService(p: ProviderKind) {
  preferred = p;
  for (const l of listeners) l(p);
  void SecureStore.setItemAsync(KEY, p).catch(() => undefined);
}

export function usePreferredService(): ProviderKind | null {
  const [p, setP] = useState(preferred);
  useEffect(() => {
    listeners.add(setP);
    if (!loaded) {
      loaded = true;
      void SecureStore.getItemAsync(KEY)
        .then((v) => {
          if (v && !preferred) {
            preferred = v as ProviderKind;
            for (const l of listeners) l(preferred);
          }
        })
        .catch(() => undefined);
    }
    return () => {
      listeners.delete(setP);
    };
  }, []);
  return p;
}

export { chooseOption } from "./format";
