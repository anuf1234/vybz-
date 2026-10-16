import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import Link from "next/link";
import { BattleCard } from "@/components/battle/battle-card";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { requireActor } from "@/lib/auth/server";
import { battles } from "@/lib/battles";
import { cardSelect, toCard } from "@/lib/battles/lists";

export const metadata: Metadata = { title: "My battles" };
export const dynamic = "force-dynamic";

const TABS = [
  { id: "now", label: "Needs you" },
  { id: "live", label: "In play" },
  { id: "history", label: "History" },
] as const;

export default async function MyBattles({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActor({ next: "/battles/my" });
  const want = (await searchParams).tab;
  const tab = TABS.find((t) => t.id === want)?.id ?? "now";
  // Keep the lists honest: move any of my battles past passed deadlines first.
  await battles.advanceDue({ userId: actor.id }).catch(() => undefined);

  const mine = { OR: [{ participants: { some: { userId: actor.id } } }, { invitedUserId: actor.id }] };
  const rows = await prisma.battle.findMany({
    where: {
      ...mine,
      status:
        tab === "history"
          ? { in: ["COMPLETED", "CANCELLED"] }
          : tab === "live"
            ? { in: ["CHALLENGE_SENT", "ACCEPTED", "SCHEDULED", "ACTIVE", "VOTING"] }
            : { in: ["CHALLENGE_SENT", "ACCEPTED"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: cardSelect,
  });

  // "Needs you": challenges sent to me, and lineups I still owe.
  const list =
    tab === "now"
      ? rows.filter(
          (b) =>
            (b.status === "CHALLENGE_SENT" && b.invitedUserId === actor.id) ||
            (b.status === "ACCEPTED" && b.participants.some((p) => p.userId === actor.id && p.side === 1 && !p.lineupLockedAt)),
        )
      : tab === "live"
        ? rows.filter((b) => b.participants.some((p) => p.userId === actor.id))
        : rows;

  return (
    <div>
      <PageHeader eyebrow="Mine" title="My battles" />
      <nav aria-label="Battle lists" className="mt-6 flex gap-1 rounded-full bg-surface-1 p-1">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/battles/my?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className="flex-1 rounded-full px-3 py-2 text-center text-sm font-medium text-muted aria-[current=page]:bg-violet aria-[current=page]:text-white"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <section className="mt-6 space-y-3">
        <SectionTitle>{TABS.find((t) => t.id === tab)!.label}</SectionTitle>
        {list.length ? (
          <ul className="space-y-2">
            {list.map((b) => (
              <BattleCard key={b.id} b={toCard(b, actor.id)} />
            ))}
          </ul>
        ) : tab === "now" ? (
          <EmptyState title="You're all caught up" body="No challenges or picks waiting on you." action={{ href: "/battle/create", label: "+ Battle" }} icon="✅" />
        ) : tab === "live" ? (
          <EmptyState title="Nothing in play" body="Challenge someone or take an open challenge." action={{ href: "/battle", label: "Find a battle" }} />
        ) : (
          <EmptyState title="No battles yet" body="Finished battles land here." action={{ href: "/battle/create", label: "Start your first" }} />
        )}
      </section>
    </div>
  );
}
