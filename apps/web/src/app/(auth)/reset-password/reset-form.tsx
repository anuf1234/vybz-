"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Button, Field, FormMessage } from "@/components/ui/form";

export function ResetForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<"idle" | "done" | { error: string }>("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.resetPassword({
      token,
      newPassword: String(new FormData(e.currentTarget).get("password") ?? ""),
    });
    setPending(false);
    if (!error) return setState("done");
    setState({
      error:
        error.code === "PASSWORD_COMPROMISED"
          ? "That password has appeared in a data breach. Pick a different one."
          : error.code === "PASSWORD_TOO_SHORT"
            ? "Use at least 10 characters."
            : "This link has expired or was already used. Request a new one.",
    });
  }

  if (state === "done") {
    return (
      <FormMessage tone="success">
        Password updated, and you've been signed out everywhere else.{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
      </FormMessage>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {typeof state === "object" && <FormMessage>{state.error}</FormMessage>}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={128}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Set new password"}
      </Button>
    </form>
  );
}
