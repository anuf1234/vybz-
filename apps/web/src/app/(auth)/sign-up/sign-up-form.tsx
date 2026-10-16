"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Button, Divider, Field, FormMessage } from "@/components/ui/form";
import { GoogleButton } from "../google-button";

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name") ?? "").trim(),
      email,
      password: String(form.get("password") ?? ""),
      callbackURL: "/onboarding",
    });
    setPending(false);
    // An already-registered email gets the same response as a new one, so the
    // form can't be used to discover who has an account.
    if (error && error.code !== "USER_ALREADY_EXISTS" && error.code !== "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      setError(messageFor(error.code));
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <FormMessage tone="success">
        Check <strong>{sentTo}</strong> for a link to confirm your email. It expires in 24 hours.
      </FormMessage>
    );
  }

  return (
    <div className="space-y-6">
      {googleEnabled && (
        <>
          <GoogleButton label="Sign up with Google" />
          <Divider />
        </>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <FormMessage>{error}</FormMessage>}
        <Field label="Display name" name="name" autoComplete="nickname" required maxLength={40} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          hint="At least 10 characters. A short phrase works well."
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Creating account" : "Create account"}
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        Already on VYBZ?{" "}
        <Link href="/sign-in" className="text-violet-soft hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

function messageFor(code: string | undefined): string {
  switch (code) {
    case "PASSWORD_TOO_SHORT":
      return "Use at least 10 characters for your password.";
    case "PASSWORD_COMPROMISED":
      return "That password has appeared in a data breach. Pick a different one.";
    case "INVALID_EMAIL":
      return "That email address doesn't look right.";
    default:
      return "Something went wrong. Try again in a moment.";
  }
}
