import type { Metadata } from "next";
import { AuthCard } from "@/components/ui/form";
import { requireActor } from "@/lib/auth/server";
import { NewBattleForm } from "./new-battle-form";

export const metadata: Metadata = { title: "New battle" };

export default async function NewBattlePage({ searchParams }: { searchParams: Promise<{ opponent?: string }> }) {
  await requireActor();
  const { opponent } = await searchParams;
  return (
    <AuthCard title="New battle" subtitle="Set the theme and the rules. Each round, you and your opponent pick one track and the crowd votes.">
      <NewBattleForm opponent={typeof opponent === "string" ? opponent.slice(0, 21) : ""} />
    </AuthCard>
  );
}
