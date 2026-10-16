import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import { BattleCard } from "@/components/battle/battle-card";
import { OpenChallengeCard } from "@/components/battle/open-challenge";
import { LinkButton } from "@/components/ui/button";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { getActor } from "@/lib/auth/server";
import { cardSelect, listedWhere, openChallengeSelect, openChallengeWhere, toCard, toOpenChallenge } from "@/lib/battles/lists";

export const metadata: Metadata = { title: "Battles" };
export const dynamic = "force-dynamic";

export default async function BattleHub() {
  const actor = await getActor();
  const now = new Date();
  const [live, open, recent] = await Promise.all([
    prisma.battle.findMany({
      where: { ...listedWhere, status: { in: ["ACTIVE", "VOTING"] } },
      orderBy: { votingEndsAt: "asc" },
      take: 12,
      select: cardSelect,
    }),
    prisma.battle.findMany({ where: openChallengeWhere(now), orderBy: { sentAt: "desc" }, take: 12, select: openChallengeSelect }),
    prisma.battle.findMany({
      where: { ...listedWhere, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      take: 8,
      select: cardSelect,
    }),
  ]);
  const me = actor?.id ?? null;

  return (
    <div>
      <PageHeader eyebrow="Battles" title="Vote now">
        Listen to both sides, pick the better track. The crowd decides every round.
      </PageHeader>
      <LinkButton href="/battle/create" size="lg" block className="mt-6 sm:w-auto">
        + Start a battle
      </LinkButton>

      <section className="mt-10 space-y-3">
        <SectionTitle>Live now</SectionTitle>
        {live.length ? (
          <ul className="space-y-2">
            {live.map((b) => (
              <BattleCard key={b.id} b={toCard(b, me)} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing live right now" body="Accept an open challenge below or start your own." icon="🎙️" />
        )}
      </section>

      <section className="mt-10 space-y-3" id="open">
        <SectionTitle>Open challenges</SectionTitle>
        {open.length ? (
          <ul className="space-y-2">
            {open.map((b) => (
              <OpenChallengeCard key={b.id} c={toOpenChallenge(b, me)} signedIn={actor !== null} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No open challenges" body="Post one and let anyone take you on." action={{ href: "/battle/create", label: "Post a challenge" }} icon="📣" />
        )}
      </section>

      {recent.length > 0 && (
        <section className="mt-10 space-y-3">
          <SectionTitle>Recent results</SectionTitle>
          <ul className="space-y-2">
            {recent.map((b) => (
              <BattleCard key={b.id} b={toCard(b, me)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
