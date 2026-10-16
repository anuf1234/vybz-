"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/form";

export function GoogleButton({ label, callbackURL = "/onboarding" }: { label: string; callbackURL?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        // New Google users land on onboarding to pick a username; returning users pass straight through.
        await authClient.signIn.social({ provider: "google", callbackURL });
      }}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-4">
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
      </svg>
      {pending ? "Opening Google" : label}
    </Button>
  );
}
