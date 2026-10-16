import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import Link from "next/link";
import { BattleCard } from "@/components/battle/battle-card";
import { OpenChallengeCard } from "@/components/battle/open-challenge";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { getActor } from "@/lib/auth/server";
import { cardSelect, listedWhere, openChallengeSelect, openChallengeWhere, toCard, toOpenChallenge } from "@/lib/battles/lists";
import { levelFor } from "@/lib/progression";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

export default async function Discover() {
  const actor = await getActor();
  const me = actor?.id ?? null;
  const [open, live, results, people] = await Promise.all([
    prisma.battle.findMany({ where: openChallengeWhere(), orderBy: { sentAt: "desc" }, take: 4, select: openChallengeSelect }),
    prisma.battle.findMany({
      where: { ...listedWhere, status: { in: ["ACTIVE", "VOTING"] } },
      orderBy: { startsAt: "desc" },
      take: 6,
      select: cardSelect,
    }),
    prisma.battle.findMany({ where: { ...listedWhere, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 6, select: cardSelect }),
    prisma.profile.findMany({
      where: { user: { status: "ACTIVE" }, ...(me ? { userId: { not: me }, user: { status: "ACTIVE", followers: { none: { followerId: me } } } } : {}) },
      orderBy: { xp: "desc" },
      take: 6,
      select: { username: true, displayName: true, xp: true, favoriteGenres: true },
    }),
  ]);

  return (
    <div>
      <PageHeader eyebrow="Discover" title="What's hot">
        Live battles, open challenges and the people with the best ears.
      </PageHeader>

      <section className="mt-8 space-y-3">
        <SectionTitle action={<Link href="/battle#open" className="text-xs text-muted hover:text-text">See all</Link>}>Open challenges</SectionTitle>
        {open.length ? (
          <ul className="space-y-2">
            {open.map((b) => (
              <OpenChallengeCard key={b.id} c={toOpenChallenge(b, me)} signedIn={actor !== null} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No open challenges" body="Be the first to throw one down." action={{ href: "/battle/create", label: "+ Battle" }} icon="📣" />
        )}
      </section>

      <section className="mt-10 space-y-3">
        <SectionTitle>Live battles</SectionTitle>
        {live.length ? (
          <ul className="space-y-2">
            {live.map((b) => (
              <BattleCard key={b.id} b={toCard(b, me)} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No live battles right now.</p>
        )}
      </section>

      <section className="mt-10 space-y-3">
        <SectionTitle>People to follow</SectionTitle>
        {people.length ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {people.map((p) => (
              <li key={p.username}>
                <Link href={`/profile/${p.username}`} className="flex h-full flex-col items-center rounded-2xl border border-line bg-surface-1 p-4 text-center hover:border-violet">
                  <Avatar name={p.displayName} />
                  <p className="mt-2 w-full truncate text-sm font-semibold">{p.displayName}</p>
                  <p className="w-full truncate text-xs text-muted">@{p.username}</p>
                  <p className="mt-1 text-[11px] text-violet-soft">
                    Level {levelFor(p.xp).level}
                    {p.favoriteGenres[0] ? ` · ${p.favoriteGenres[0]}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">You&apos;re following everyone. Nice.</p>
        )}
      </section>

      {results.length > 0 && (
        <section className="mt-10 space-y-3">
          <SectionTitle>Recent results</SectionTitle>
          <ul className="space-y-2">
            {results.map((b) => (
              <BattleCard key={b.id} b={toCard(b, me)} />
            ))}
          </ul>
        </section>
      )}

      {!actor && (
        <div className="mt-10 rounded-2xl border border-violet/40 bg-plum p-5 text-center">
          <p className="font-display text-2xl font-bold uppercase">Think your taste wins?</p>
          <LinkButton href="/signup" className="mt-3">
            Join VYBZ
          </LinkButton>
        </div>
      )}
    </div>
  );
}
