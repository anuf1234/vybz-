import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import Link from "next/link";
import { getActor } from "@/lib/auth/server";
import { battles } from "@/lib/battles";
import { parseRules } from "@/lib/battles/model";
import { ruleSummary } from "@/lib/battles/view";
import { timeLeft } from "@/lib/time";

export const metadata: Metadata = { title: "Battles" };

const listSelect = {
  id: true,
  theme: true,
  status: true,
  rules: true,
  roundCount: true,
  winnerSide: true,
  expiresAt: true,
  invitedUserId: true,
  creator: { select: { handle: true } },
  invitedUser: { select: { handle: true } },
  participants: { select: { side: true, userId: true, user: { select: { handle: true } } } },
  rounds: {
    orderBy: { index: "desc" },
    take: 1,
    select: { index: true, status: true, submissionsCloseAt: true, votingClosesAt: true, submissions: { select: { side: true } } },
  },
} as const;

export default async function BattlesPage() {
  const actor = await getActor();
  // Move anything past its deadline before listing, so statuses are current.
  await battles.advanceDue(25);

  const [voteNow, open, mine] = await Promise.all([
    prisma.battle.findMany({
      where: {
        status: "IN_PROGRESS",
        rounds: { some: { status: "VOTING_OPEN" } },
        ...(actor ? { participants: { none: { userId: actor.id } } } : {}),
      },
      orderBy: { nextDeadline: "asc" },
      take: 10,
      select: listSelect,
    }),
    prisma.battle.findMany({
      where: { status: "OPEN", ...(actor ? { creatorId: { not: actor.id } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: listSelect,
    }),
    actor
      ? prisma.battle.findMany({
          where: { OR: [{ participants: { some: { userId: actor.id } } }, { invitedUserId: actor.id }] },
          orderBy: { updatedAt: "desc" },
          take: 20,
          select: listSelect,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="pt-8">
      <div className="flex items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-bold uppercase">Battles</h1>
        <Link
          href={actor ? "/battles/new" : "/sign-in"}
          className="shrink-0 rounded-full bg-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet/85"
        >
          New battle
        </Link>
      </div>

      {actor && mine.length > 0 && (
        <Section title="Your battles">
          {mine.map((b) => (
            <BattleRow key={b.id} battle={b} line={myLine(b, actor.id)} />
          ))}
        </Section>
      )}

      <Section title="Vote now" empty="Nothing to vote on right now. Start a battle and get the crowd going.">
        {voteNow.map((b) => {
          const r = b.rounds[0]!;
          return (
            <BattleRow
              key={b.id}
              battle={b}
              live
              line={`Round ${r.index + 1} voting · ${r.votingClosesAt ? timeLeft(r.votingClosesAt) : ""}`}
            />
          );
        })}
      </Section>

      <Section title="Open challenges" empty="No open challenges. Post one and anyone can take you on.">
        {open.map((b) => (
          <BattleRow key={b.id} battle={b} line={`Waiting for an opponent · ${timeLeft(b.expiresAt)}`} />
        ))}
      </Section>
    </div>
  );
}

type Row = Awaited<ReturnType<typeof prisma.battle.findMany<{ select: typeof listSelect }>>>[number];

function myLine(b: Row, me: string): string {
  const mine = b.participants.find((p) => p.userId === me);
  const opp = b.participants.find((p) => p.userId !== me)?.user.handle;
  const r = b.rounds[0];
  switch (b.status) {
    case "OPEN":
      return "Open challenge, waiting for an opponent";
    case "PENDING_ACCEPT":
      return b.invitedUserId === me
        ? `@${b.creator.handle} challenged you`
        : `Waiting for @${b.invitedUser?.handle} to accept`;
    case "IN_PROGRESS":
      if (!r || !mine) return "In progress";
      if (r.status === "VOTING_OPEN") return `Round ${r.index + 1}: the crowd is voting`;
      return r.submissions.some((s) => s.side === mine.side)
        ? `Round ${r.index + 1}: waiting for @${opp}'s pick`
        : `Round ${r.index + 1}: your pick · ${timeLeft(r.submissionsCloseAt)}`;
    case "COMPLETE":
      if (b.winnerSide === null || !mine) return `Draw with @${opp}`;
      return b.winnerSide === mine.side ? `You beat @${opp}` : `@${opp} won`;
    case "CANCELLED":
      return "Called off";
    case "EXPIRED":
      return "Nobody accepted in time";
  }
}

function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-soft">{title}</h2>
      {children.length > 0 ? (
        <ul className="mt-3 space-y-2">{children}</ul>
      ) : (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      )}
    </section>
  );
}

function BattleRow({ battle: b, line, live = false }: { battle: Row; line: string; live?: boolean }) {
  const side = (s: 0 | 1) => b.participants.find((p) => p.side === s)?.user.handle;
  const left = side(0) ?? b.creator.handle;
  const right = side(1) ?? b.invitedUser?.handle ?? null;
  return (
    <li>
      <Link
        href={`/battles/${b.id}`}
        className="block rounded-xl border border-line bg-surface-1 p-4 transition-colors hover:border-violet"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="truncate font-semibold">{b.theme}</p>
          {live && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-live">
              <span className="size-1.5 rounded-full bg-live" aria-hidden /> Live
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-muted">
          @{left} <span className="text-xs">vs</span> {right ? `@${right}` : "anyone"}
        </p>
        <p className="mt-2 text-xs text-muted">
          {line} <span className="text-line">·</span> {ruleSummary(parseRules(b.rules))}
        </p>
      </Link>
    </li>
  );
}
