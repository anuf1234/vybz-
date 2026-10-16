"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Btn } from "@/components/ui/button";
import { markNotificationsRead } from "@/lib/actions/social";

export function MarkRead() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Btn
      size="sm"
      variant="ghost"
      className="mt-4"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markNotificationsRead();
          router.refresh();
        })
      }
    >
      Mark all read
    </Btn>
  );
}
