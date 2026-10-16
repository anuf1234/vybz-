import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/ui/form";
import { getActor, googleEnabled, safeNext } from "@/lib/auth/server";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "/battle/create?welcome=1");
  if (await getActor()) redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  return (
    <AuthCard title="Join VYBZ" subtitle="Battle your music taste against anyone. The crowd decides.">
      <SignUpForm googleEnabled={googleEnabled} next={next} />
    </AuthCard>
  );
}
