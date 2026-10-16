import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/ui/form";
import { getSession, requireActor } from "@/lib/auth/server";
import { HandleForm } from "./handle-form";

export const metadata: Metadata = { title: "Pick your handle" };

export default async function OnboardingPage() {
  const actor = await requireActor({ allowMissingHandle: true });
  if (actor.handle) redirect(`/u/${actor.handle}`);
  const session = await getSession();
  const suggestion = (session?.user.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);

  return (
    <AuthCard
      title="Pick your handle"
      subtitle="This is how opponents and voters will know you. You can't change it later, so choose well."
    >
      <HandleForm suggestion={suggestion.length >= 3 ? suggestion : ""} />
    </AuthCard>
  );
}
