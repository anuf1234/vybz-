import { prisma } from "@vybz/db";
import { BattleCard } from "@/components/battle/battle-card";
import { OpenChallengeCard } from "@/components/battle/open-challenge";
import { LinkButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/card";
import { getActor } from "@/lib/auth/server";
import { cardSelect, listedWhere, openChallengeSelect, openChallengeWhere, toCard, toOpenChallenge } from "@/lib/battles/lists";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await getActor();
  const me = actor?.id ?? null;
  const [live, open] = await Promise.all([
    prisma.battle.findMany({ where: { ...listedWhere, status: { in: ["ACTIVE", "VOTING"] } }, orderBy: { startsAt: "desc" }, take: 3, select: cardSelect }),
    prisma.battle.findMany({ where: openChallengeWhere(), orderBy: { sentAt: "desc" }, take: 2, select: openChallengeSelect }),
  ]);

  return (
    <div className="pt-10 sm:pt-16">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-soft">Competitive music</p>
      <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[0.95] sm:text-7xl">
        Your taste.
        <br />
        <span className="text-violet">Their vote.</span>
      </h1>
      <p className="mt-5 max-w-md text-muted">
        Challenge anyone to a song battle. One track each per round, the crowd listens to both and decides who has the better ear.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton href={actor ? "/battle/create" : "/signup?next=/battle/create"} size="lg">
          + Start a battle
        </LinkButton>
        <LinkButton href="/battle" variant="ghost" size="lg">
          Vote on battles
        </LinkButton>
      </div>

      {open.length > 0 && (
        <section className="mt-14 space-y-3">
          <SectionTitle>Open challenges</SectionTitle>
          <ul className="space-y-2">
            {open.map((b) => (
              <OpenChallengeCard key={b.id} c={toOpenChallenge(b, me)} signedIn={actor !== null} />
            ))}
          </ul>
        </section>
      )}

      {live.length > 0 && (
        <section className="mt-10 space-y-3">
          <SectionTitle>Live now</SectionTitle>
          <ul className="space-y-2">
            {live.map((b) => (
              <BattleCard key={b.id} b={toCard(b, me)} />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-14 grid gap-3 sm:grid-cols-3" aria-label="How it works">
        {[
          ["1. Challenge", "Pick a theme like 90s R&B, choose 5, 10 or 20 rounds, and line up your songs."],
          ["2. Listen", "Voters hear both sides of every round before they can vote. No blind clicking."],
          ["3. Win", "Most rounds wins. Results, crowd favorites and rematches are kept forever."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-line bg-surface-1 p-4">
            <p className="font-display text-lg font-bold uppercase">{t}</p>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
