"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Btn } from "@/components/ui/button";
import { setFollow } from "@/lib/actions/social";

export function FollowButton({ username, following, size = "sm" }: { username: string; following: boolean; size?: "sm" | "md" }) {
  const router = useRouter();
  const [on, setOn] = useState(following);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Btn
        size={size}
        variant={on ? "ghost" : "primary"}
        disabled={pending}
        aria-pressed={on}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await setFollow(username, !on);
            if (res.ok) {
              setOn(!on);
              router.refresh();
            } else if (res.code === "UNAUTHORIZED") router.push(`/login?next=/profile/${username}`);
            else setError(res.error);
          })
        }
      >
        {on ? "Following" : `Follow @${username}`}
      </Btn>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </span>
  );
}
