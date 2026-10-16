"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { AuthCard, Button, Field, FormMessage } from "@/components/ui/form";

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    await authClient.requestPasswordReset({
      email: String(new FormData(e.currentTarget).get("email") ?? "").trim(),
      redirectTo: "/reset-password",
    });
    setPending(false);
    // Same message whether or not the account exists.
    setSent(true);
  }

  return (
    <AuthCard title="Reset password" subtitle="We'll email you a link to choose a new one.">
      {sent ? (
        <FormMessage tone="success">If that email has a VYBZ account, a reset link is on its way.</FormMessage>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Button type="submit" disabled={pending}>
            {pending ? "Sending" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="hover:text-text">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
