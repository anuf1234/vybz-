"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Btn } from "@/components/ui/button";
import { Button, Field, FormMessage } from "@/components/ui/form";
import { authClient } from "@/lib/auth/client";

export function AccountForm({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setMsg(null);
    const { error } = await authClient.changePassword({
      currentPassword: String(form.get("current") ?? ""),
      newPassword: String(form.get("new") ?? ""),
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) {
      setMsg({ tone: "error", text: error.status === 429 ? "Too many attempts. Try again later." : (error.message ?? "That didn't work.") });
    } else {
      setMsg({ tone: "success", text: "Password changed. Other devices were signed out." });
      (e.target as HTMLFormElement).reset();
    }
  }

  return (
    <div className="space-y-6">
      {hasPassword && (
        <form onSubmit={changePassword} className="space-y-4">
          {msg && <FormMessage tone={msg.tone}>{msg.text}</FormMessage>}
          <Field label="Current password" name="current" type="password" autoComplete="current-password" required />
          <Field label="New password" name="new" type="password" autoComplete="new-password" required minLength={10} maxLength={128} hint="At least 10 characters." />
          <Button type="submit" disabled={pending}>
            {pending ? "Saving" : "Change password"}
          </Button>
        </form>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line/60 pt-4">
        <Btn
          variant="ghost"
          size="sm"
          onClick={async () => {
            await authClient.revokeOtherSessions();
            setMsg({ tone: "success", text: "Signed out of every other device." });
          }}
        >
          Sign out other devices
        </Btn>
        <Btn
          variant="danger"
          size="sm"
          onClick={async () => {
            await authClient.signOut();
            router.push("/");
            router.refresh();
          }}
        >
          Sign out
        </Btn>
      </div>
    </div>
  );
}
