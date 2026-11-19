import type { ProStatus } from "@vybz/core";
import { useEffect, useState } from "react";
import { api } from "./api";
import { useSession } from "./auth-client";

/** VYBZ Pro status, shared across screens. Refresh after a purchase. */
let cached: { userId: string; status: ProStatus } | null = null;
const listeners = new Set<(s: ProStatus | null) => void>();

export async function refreshPro(): Promise<ProStatus | null> {
  try {
    const status = await api.pro();
    cached = cached ? { ...cached, status } : null;
    listeners.forEach((l) => l(status));
    return status;
  } catch {
    return null;
  }
}

export function setProStatus(userId: string, status: ProStatus): void {
  cached = { userId, status };
  listeners.forEach((l) => l(status));
}

export function usePro(): { active: boolean; status: ProStatus | null } {
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const [status, setStatus] = useState<ProStatus | null>(cached && cached.userId === userId ? cached.status : null);
  useEffect(() => {
    listeners.add(setStatus);
    return () => void listeners.delete(setStatus);
  }, []);
  useEffect(() => {
    if (!userId) return setStatus(null);
    if (cached?.userId === userId) return setStatus(cached.status);
    let alive = true;
    void api
      .pro()
      .then((s) => {
        cached = { userId, status: s };
        if (alive) setStatus(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId]);
  return { active: !!status?.active, status };
}
