import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError } from "./api";

export interface Resource<T> {
  data: T | null;
  error: ApiRequestError | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

/**
 * Loads data when the screen is focused, optionally polls while focused, and
 * keeps the last good data on screen during refreshes.
 */
export function useResource<T>(load: (() => Promise<T>) | null, deps: unknown[], opts: { pollMs?: number } = {}): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [loading, setLoading] = useState(Boolean(load));
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const run = useCallback(async (manual: boolean) => {
    const fn = loadRef.current;
    if (!fn) return;
    const mine = ++seq.current;
    if (manual) setRefreshing(true);
    try {
      const result = await fn();
      if (mine === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mine === seq.current) setError(err instanceof ApiRequestError ? err : new ApiRequestError(0, "ERROR", String(err)));
    } finally {
      if (mine === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLoading(Boolean(loadRef.current));
    void run(false);
  }, deps);

  useFocusEffect(
    useCallback(() => {
      void run(false);
      if (!opts.pollMs) return undefined;
      const t = setInterval(() => void run(false), opts.pollMs);
      return () => clearInterval(t);
    }, [run, opts.pollMs]),
  );

  return { data, error, loading, refreshing, reload: () => run(true), setData };
}

/** Re-renders every `ms` so countdowns tick. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
