"use client";

import { useEffect, useState } from "react";

/** Tells people when they've lost connection, so a failed vote doesn't look like our bug. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="sticky top-14 z-20 bg-amber-400/15 px-4 py-2 text-center text-xs font-semibold text-amber-100 backdrop-blur">
      You&apos;re offline. Votes and picks will work again once you reconnect.
    </div>
  );
}
