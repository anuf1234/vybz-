"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps a live battle current by re-fetching the server view: on an interval,
 * right after the next deadline, and when the tab comes back into view.
 * Never while something is playing, so a refresh can't cut a listen short.
 */
export function AutoRefresh({ everyMs = 20_000, deadline }: { everyMs?: number; deadline?: string | null }) {
  const router = useRouter();

  useEffect(() => {
    const playing = () => [...document.querySelectorAll("audio")].some((a) => !a.paused);
    const refresh = () => {
      if (document.visibilityState === "visible" && !playing()) router.refresh();
    };
    const interval = setInterval(refresh, everyMs);
    const due = deadline ? new Date(deadline).getTime() - Date.now() + 1_500 : null;
    const timeout = due !== null && due > 0 && due < 2 ** 31 - 1 ? setTimeout(refresh, due) : null;
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, everyMs, deadline]);

  return null;
}
