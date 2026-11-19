import type { ConfigResponse } from "@vybz/core";
import { useEffect, useState } from "react";

/** Base URL of the VYBZ web app, which serves /api/auth and /api/v1. */
// Release bundles (store builds and over-the-air updates) fall back to the live
// server, so an update published without the env var can't point at localhost.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? "http://localhost:3000" : "https://vybz-5d42.onrender.com")).replace(/\/$/, "");

let cached: ConfigResponse | null = null;

/** What the server supports (AI judge, genres...). Fetched once per app run. */
export function useServerConfig(): ConfigResponse | null {
  const [config, setConfig] = useState(cached);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    void import("./api")
      .then(({ api }) => api.config())
      .then((c) => {
        cached = c;
        if (alive) setConfig(c);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return config;
}
