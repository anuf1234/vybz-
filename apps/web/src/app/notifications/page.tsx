import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { requireActor } from "@/lib/auth/server";
import { BADGES } from "@/lib/progression";
import { MarkRead } from "./mark-read";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof load>>[number];

async function load(userId: string) {
  return prisma.notification.findMany({
    where: { recipientId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      type: true,
      battleId: true,
      data: true,
      readAt: true,
      createdAt: true,
      actor: { select: { profile: { select: { username: true } } } },
    },
  });
}

function describe(n: Row): { text: string; href: string } {
  const who = n.actor?.profile?.username ? `@${n.actor.profile.username}` : "Someone";
  const battle = n.battleId ? `/battle/${n.battleId}` : "/battles/my";
  const data = (n.data ?? {}) as Record<string, unknown>;
  switch (n.type) {
    case "CHALLENGE_RECEIVED":
      return { text: `${who} challenged you to a battle.`, href: battle };
    case "CHALLENGE_ACCEPTED":
      return { text: `${who} accepted your challenge.`, href: battle };
    case "CHALLENGE_DECLINED":
      return { text: `${who} declined your challenge.`, href: battle };
    case "LINEUP_NEEDED":
      return { text: "Your opponent didn't pick in time, so the battle was called off.", href: battle };
    case "BATTLE_LIVE":
      return { text: "Your battle is live. Rounds are open for voting.", href: battle };
    case "BATTLE_RESULT": {
      if (data.cancelled) return { text: "Your opponent didn't pick in time, so the battle was called off.", href: battle };
      const outcome = data.winnerSide === null ? "draw" : data.winnerSide === data.yourSide ? "won" : "lost";
      return {
        text: outcome === "won" ? "You won your battle! 🏆" : outcome === "lost" ? "Your battle is over. See how the crowd voted." : "Your battle ended in a draw.",
        href: n.battleId ? `/battle/${n.battleId}/results` : battle,
      };
    }
    case "NEW_FOLLOWER":
      return { text: `${who} followed you.`, href: n.actor?.profile?.username ? `/profile/${n.actor.profile.username}` : "/" };
    case "BADGE_EARNED": {
      const badge = BADGES.find((b) => b.code === data.code);
      return { text: badge ? `You earned the ${badge.icon} ${badge.name} badge.` : "You earned a badge.", href: "/settings" };
    }
  }
}

export default async function Notifications() {
  const actor = await requireActor({ next: "/notifications" });
  const rows = await load(actor.id);
  const unread = rows.some((r) => !r.readAt);
  return (
    <div>
      <PageHeader eyebrow="Inbox" title="Notifications" />
      {unread && <MarkRead />}
      {rows.length ? (
        <ul className="mt-6 divide-y divide-line/60 rounded-2xl border border-line bg-surface-1">
          {rows.map((n) => {
            const d = describe(n);
            return (
              <li key={n.id}>
                <Link href={d.href} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-violet"}`} aria-label={n.readAt ? undefined : "Unread"} />
                  <span className="min-w-0 flex-1 text-sm">{d.text}</span>
                  <time dateTime={n.createdAt.toISOString()} className="shrink-0 text-xs text-muted">
                    {n.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-6">
          <EmptyState title="Nothing yet" body="Challenges, results and new followers show up here." icon="🔔" />
        </div>
      )}
    </div>
  );
}
