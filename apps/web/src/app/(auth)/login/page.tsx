import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard, FormMessage } from "@/components/ui/form";
import { getActor, googleEnabled, safeNext } from "@/lib/auth/server";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const to = safeNext(next, "/discover");
  if (await getActor()) redirect(`/onboarding?next=${encodeURIComponent(to)}`);
  return (
    <AuthCard title="Welcome back" subtitle="Log in to battle, vote and follow.">
      {error && (
        <div className="mb-6">
          <FormMessage>
            {error === "account_banned" ? "This account has been banned." : "Sign-in didn't complete. Please try again."}
          </FormMessage>
        </div>
      )}
      <SignInForm googleEnabled={googleEnabled} next={to} />
    </AuthCard>
  );
}
