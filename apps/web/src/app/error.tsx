"use client";

import { useEffect } from "react";
import { Btn, LinkButton } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/states";

/** Any unexpected server or render error inside the layout. The digest matches the server log line. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <StatusPage
      code={offline ? "…" : "500"}
      title={offline ? "You're offline" : "Something broke"}
      body={
        offline ? (
          "Check your connection, then try again."
        ) : (
          <>
            That&apos;s on us, not you. Try again in a moment.
            {error.digest && <span className="mt-2 block text-xs">Reference: {error.digest}</span>}
          </>
        )
      }
      actions={
        <>
          <Btn onClick={reset}>Try again</Btn>
          <LinkButton href="/" variant="ghost">
            Home
          </LinkButton>
        </>
      }
    />
  );
}
