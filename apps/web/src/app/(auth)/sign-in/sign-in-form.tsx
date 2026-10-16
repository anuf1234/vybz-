"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Button, Divider, Field, FormMessage } from "@/components/ui/form";
import { GoogleButton } from "../google-button";

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setMessage(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
      callbackURL: "/onboarding",
    });
    setPending(false);
    if (!error) {
      router.push("/onboarding");
      router.refresh();
      return;
    }
    switch (error.code) {
      case "EMAIL_NOT_VERIFIED":
        setMessage({ tone: "success", text: "Confirm your email first. We just sent you a fresh link." });
        break;
      case "ACCOUNT_BANNED":
        setMessage({ tone: "error", text: "This account has been banned." });
        break;
      default:
        setMessage({
          tone: "error",
          text: error.status === 429 ? "Too many attempts. Wait a minute and try again." : "That email and password don't match.",
        });
    }
  }

  return (
    <div className="space-y-6">
      {googleEnabled && (
        <>
          <GoogleButton label="Continue with Google" />
          <Divider />
        </>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
        <div className="text-right">
          <Link href="/forgot-password" className="text-xs text-muted hover:text-text">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Signing in" : "Sign in"}
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        New here?{" "}
        <Link href="/sign-up" className="text-violet-soft hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
