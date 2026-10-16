import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, FormMessage } from "@/components/ui/form";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return (
    <AuthCard title="New password">
      {!token || error ? (
        <FormMessage>
          This reset link is invalid or has expired.{" "}
          <Link href="/forgot-password" className="underline">
            Request a new one
          </Link>
        </FormMessage>
      ) : (
        <ResetForm token={token} />
      )}
    </AuthCard>
  );
}
