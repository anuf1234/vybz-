import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/ui/form";
import { getSession, requireActor, safeNext } from "@/lib/auth/server";
import { UsernameForm } from "./username-form";

export const metadata: Metadata = { title: "Pick your username" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "/battle/create?welcome=1");
  const actor = await requireActor({ allowMissingHandle: true, next: `/onboarding?next=${encodeURIComponent(next)}` });
  if (actor.handle) redirect(next);
  const session = await getSession();
  const name = session?.user.name ?? "";
  const suggestion = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);

  return (
    <AuthCard
      title="Pick your username"
      subtitle="This is how opponents and voters will know you. Usernames are permanent, so choose well."
    >
      <UsernameForm suggestion={suggestion.length >= 3 ? suggestion : ""} displayName={name.slice(0, 40)} next={next} />
    </AuthCard>
  );
}
