import type { ConfigResponse } from "@vybz/core";
import { useEffect, useState } from "react";

/** Base URL of the VYBZ web app, which serves /api/auth and /api/v1. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

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

/** Spotify buttons show only once the server has Spotify set up. */
export function useSpotifyEnabled(): boolean {
  return useServerConfig()?.spotify === true;
}
