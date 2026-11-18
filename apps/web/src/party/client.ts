"use client";

import { useEffect, useRef, useState } from "react";

export async function partyCall<T>(path: string, key: string | null, init?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = {};
  if (key) headers["x-party-key"] = key;
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, { method: init?.method ?? "GET", headers, body: init?.body !== undefined ? JSON.stringify(init.body) : undefined, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) {
    const err = new Error(data.message ?? `Something went wrong (${data.error ?? res.status}).`) as Error & { code?: string; status?: number };
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const hostKeyName = (code: string) => `vybz-party-host-${code}`;
export const playerKeyName = (code: string) => `vybz-party-player-${code}`;

export function readKey(name: string): string | null {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

export function writeKey(name: string, v: string | null) {
  try {
    if (v) localStorage.setItem(name, v);
    else localStorage.removeItem(name);
  } catch {
    // Private mode: the key lives for this page only.
  }
}

/** Polls `fn` every `ms` while the page is visible. */
export function usePoll<T>(fn: (() => Promise<T>) | null, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<(Error & { code?: string }) | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!fn) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const d = await fnRef.current!();
        if (alive) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e as Error);
      }
      if (alive) timer = setTimeout(run, document.hidden ? ms * 4 : ms);
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!fn, ms, tick]);
  return { data, setData, error, refresh: () => setTick((t) => t + 1) };
}

/** Seconds left on a server deadline, using the server's clock. */
export function useCountdown(deadline: string | null, serverNow: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  useEffect(() => {
    if (serverNow) offset.current = Date.parse(serverNow) - Date.now();
  }, [serverNow]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((Date.parse(deadline) - (now + offset.current)) / 1000));
}

export const CHOICE_COLORS = ["#8B5CF6", "#F5A524", "#22D3EE", "#F472B6", "#A3E635", "#FB923C"];
export const CHOICE_SHAPES = ["▲", "◆", "●", "■", "★", "✚"];
