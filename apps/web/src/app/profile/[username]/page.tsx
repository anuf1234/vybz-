import { HandleSchema, can } from "@vybz/core";
import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BattleCard } from "@/components/battle/battle-card";
import { FollowButton } from "@/components/social/follow-button";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/states";
import { getActor } from "@/lib/auth/server";
import { cardSelect, listedWhere, toCard } from "@/lib/battles/lists";
import { levelFor } from "@/lib/progression";

type Params = { params: Promise<{ username: string }> };

const loadProfile = cache(async (raw: string) => {
  const parsed = HandleSchema.safeParse(decodeURIComponent(raw));
  if (!parsed.success) return null;
  return prisma.profile.findUnique({
    where: { username: parsed.data },
    include: {
      user: { select: { id: true, role: true, status: true, createdAt: true } },
    },
  });
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await loadProfile((await params).username);
  if (!p || p.user.status === "BANNED") return { title: "Not found" };
  return { title: `${p.displayName} (@${p.username})`, description: p.bio ?? undefined };
}

export default async function ProfilePage({ params }: Params) {
  const [p, actor] = await Promise.all([loadProfile((await params).username), getActor()]);
  if (!p || !can(actor, { type: "profile.view", target: p.user }).allow) notFound();
  const userId = p.userId;
  const isOwner = actor?.id === userId;

  const [finished, followers, following, iFollow, badges, history, open] = await Promise.all([
    prisma.battleParticipant.findMany({
      where: { userId, battle: { status: "COMPLETED" } },
      select: { side: true, battle: { select: { winnerSide: true } } },
    }),
    prisma.follow.count({ where: { followeeId: userId } }),
    prisma.follow.count({ where: { followerId: userId } }),
    actor && !isOwner
      ? prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: actor.id, followeeId: userId } } })
      : null,
    prisma.userBadge.findMany({ where: { userId }, include: { badge: true }, orderBy: { awardedAt: "asc" } }),
    prisma.battle.findMany({
      where: { ...listedWhere, status: { in: ["COMPLETED", "VOTING", "ACTIVE"] }, participants: { some: { userId } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: cardSelect,
    }),
    prisma.battle.findMany({
      where: { ...listedWhere, status: "CHALLENGE_SENT", creatorId: userId, mode: { not: "DIRECT" } },
      orderBy: { sentAt: "desc" },
      take: 5,
      select: cardSelect,
    }),
  ]);
  const wins = finished.filter((x) => x.battle.winnerSide === x.side).length;
  const losses = finished.filter((x) => x.battle.winnerSide !== null && x.battle.winnerSide !== x.side).length;
  const level = levelFor(p.xp);
  const joined = p.user.createdAt.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="pt-8">
      <div className="flex items-start gap-4">
        <Avatar name={p.displayName} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-3xl font-bold">{p.displayName}</h1>
          <p className="text-sm text-muted">
            @{p.username}
            {p.user.role !== "USER" && (
              <span className="ml-2">
                <Chip>{p.user.role === "CREATOR" ? "DJ / Creator" : p.user.role.toLowerCase()}</Chip>
              </span>
            )}
          </p>
          {/* Plain text only: React escapes it, and whitespace-pre-line keeps line breaks. */}
          {p.bio && <p className="mt-3 whitespace-pre-line text-sm">{p.bio}</p>}
          {p.favoriteGenres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.favoriteGenres.map((g) => (
                <Chip key={g} tone="muted">
                  {g}
                </Chip>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            Level {level.level} · {p.xp} XP · {followers} follower{followers === 1 ? "" : "s"} · {following} following · Joined {joined}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {isOwner ? (
          <LinkButton href="/settings" variant="ghost" size="sm">
            Edit profile
          </LinkButton>
        ) : actor ? (
          <>
            <LinkButton href={`/battle/create?opponent=${p.username}`} size="sm">
              Challenge @{p.username}
            </LinkButton>
            <FollowButton username={p.username} following={Boolean(iFollow)} />
          </>
        ) : (
          <LinkButton href={`/login?next=/profile/${p.username}`} size="sm">
            Log in to challenge or follow
          </LinkButton>
        )}
      </div>

      <section aria-label="Battle record" className="mt-8 grid grid-cols-3 gap-2">
        {[
          ["Wins", wins],
          ["Losses", losses],
          ["Battles", finished.length],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="font-display text-3xl font-bold tabular-nums">{value}</p>
            <p className="text-xs uppercase tracking-widest text-muted">{label}</p>
          </Card>
        ))}
      </section>

      <section className="mt-10 space-y-3">
        <SectionTitle>Badges</SectionTitle>
        {badges.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <li key={b.badgeId} title={b.badge.description} className="flex items-center gap-2 rounded-full border border-line bg-surface-1 px-3 py-1.5 text-sm">
                <span aria-hidden>{b.badge.icon}</span>
                {b.badge.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No badges yet. Finish a battle to earn the first one.</p>
        )}
      </section>

      {open.length > 0 && (
        <section className="mt-10 space-y-3">
          <SectionTitle>Open challenges</SectionTitle>
          <ul className="space-y-2">
            {open.map((b) => (
              <BattleCard key={b.id} b={toCard(b, actor?.id ?? null)} />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 space-y-3">
        <SectionTitle>Battle history</SectionTitle>
        {history.length > 0 ? (
          <ul className="space-y-2">
            {history.map((b) => (
              <BattleCard key={b.id} b={toCard(b, actor?.id ?? null)} />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No battles yet"
            body={isOwner ? "Start one. It takes about a minute." : `@${p.username} hasn't battled yet.`}
            {...(isOwner ? { action: { href: "/battle/create", label: "+ Battle" } } : {})}
          />
        )}
      </section>
    </div>
  );
}
