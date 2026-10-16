import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard, FormMessage } from "@/components/ui/form";
import { getActor, googleEnabled } from "@/lib/auth/server";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getActor()) redirect("/onboarding");
  const { error } = await searchParams;
  return (
    <AuthCard title="Welcome back">
      {error && (
        <div className="mb-6">
          <FormMessage>
            {error === "account_banned" ? "This account has been banned." : "Sign-in didn't complete. Please try again."}
          </FormMessage>
        </div>
      )}
      <SignInForm googleEnabled={googleEnabled} />
    </AuthCard>
  );
}
