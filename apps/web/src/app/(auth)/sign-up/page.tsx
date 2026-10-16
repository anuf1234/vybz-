import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/ui/form";
import { getActor, googleEnabled } from "@/lib/auth/server";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await getActor()) redirect("/onboarding");
  return (
    <AuthCard title="Join VYBZ" subtitle="Battle your music taste against anyone. The crowd decides.">
      <SignUpForm googleEnabled={googleEnabled} />
    </AuthCard>
  );
}
