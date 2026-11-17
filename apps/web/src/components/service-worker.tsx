"use client";

import { useEffect } from "react";

/** Registers the PWA service worker in production builds. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.warn("service worker registration failed", err));
  }, []);
  return null;
}
