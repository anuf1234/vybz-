"use client";

import { useSyncExternalStore } from "react";

function format(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// One shared one-second clock for every countdown on the page.
const subscribe = (cb: () => void) => {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
};
const second = () => Math.floor(Date.now() / 1000) * 1000;
const serverSecond = () => null;

/** Live "2h 14m" until a moment. Renders empty on the server to avoid hydration mismatches. */
export function Countdown({ to, prefix = "", suffix = "" }: { to: string; prefix?: string; suffix?: string }) {
  const now = useSyncExternalStore(subscribe, second, serverSecond);
  return (
    <time dateTime={to} suppressHydrationWarning>
      {prefix}
      {now === null ? "" : format(new Date(to).getTime() - now)}
      {suffix}
    </time>
  );
}
