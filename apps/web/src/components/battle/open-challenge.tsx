"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Btn } from "@/components/ui/button";
import { acceptBattle } from "@/lib/actions/battles";

export interface OpenChallengeData {
  id: string;
  creator: string;
  creatorName: string;
  theme: string;
  tagline: string | null;
  format: string;
  expiresIn: string;
  mine: boolean;
}

/** "Marcus says nobody can beat his 90s R&B playlist" with a one-tap accept. */
export function OpenChallengeCard({ c, signedIn }: { c: OpenChallengeData; signedIn: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const line = c.tagline ?? `Nobody can beat my ${c.theme} picks.`;
  return (
    <li className="rounded-2xl border border-line bg-surface-1 p-4">
      <Link href={`/battle/${c.id}`} className="block">
        <p className="text-sm text-muted">
          <span className="font-semibold text-text">{c.creatorName}</span> @{c.creator} says
        </p>
        <p className="mt-1 font-display text-xl italic leading-snug">“{line}”</p>
        <p className="mt-2 text-xs text-muted">
          {c.theme} · {c.format} · {c.expiresIn}
        </p>
      </Link>
      {!c.mine && (
        <div className="mt-3">
          <Btn
            block
            disabled={pending}
            onClick={() => {
              if (!signedIn) return router.push(`/login?next=/battle/${c.id}`);
              start(async () => {
                setError(null);
                const res = await acceptBattle(c.id);
                if (res.ok) router.push(`/battle/${c.id}`);
                else if (res.code === "UNAUTHORIZED") router.push(`/login?next=/battle/${c.id}`);
                else setError(res.error);
              });
            }}
          >
            {pending ? "Accepting…" : "Accept challenge"}
          </Btn>
          {error && (
            <p role="alert" className="mt-2 text-xs text-red-300">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
