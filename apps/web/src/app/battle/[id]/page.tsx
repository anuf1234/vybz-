import { can } from "@vybz/core";
import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AutoRefresh } from "@/components/battle/auto-refresh";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Countdown } from "@/components/ui/countdown";
import { ShareButton } from "@/components/ui/share-button";
import { getActor } from "@/lib/auth/server";
import { type BattleView, loadBattleView } from "@/lib/battles/view";
import { configured } from "@/lib/providers";
import { storage } from "@/lib/uploads/storage";
import { ChallengeActions, type CommentView, Comments, LineupBuilder, RoundStepper } from "./stage";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; round?: string }> };

const load = cache(async (id: string) => {
  if (!/^[a-z0-9]{1,40}$/i.test(id)) return null;
  return loadBattleView(id, await getActor());
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const b = await load((await params).id);
  if (!b) return { title: "Battle not found" };
  const vs = `@${b.players[0].username} vs ${b.players[1] ? `@${b.players[1].username}` : "?"}`;
  return {
    title: b.title,
    description: `${b.theme} · ${vs}`,
    ...(b.visibility === "PRIVATE" ? { robots: { index: false } } : {}),
  };
}

export default async function BattlePage({ params, searchParams }: Params) {
  const { id } = await params;
  const q = await searchParams;
  const [b, actor] = await Promise.all([load(id), getActor()]);
  if (!b) notFound();

  const comments = await loadComments(b.id, actor);
  const [A, B] = b.players;
  const live = b.status === "ACTIVE" || b.status === "VOTING";
  const deadline =
    b.status === "CHALLENGE_SENT" ? b.expiresAt : b.status === "ACCEPTED" ? b.lineupDueAt : b.status === "SCHEDULED" ? b.startsAt : live ? b.votingEndsAt : null;
  const firstOpen = Math.max(0, b.rounds.findIndex((r) => r.revealed && r.myVote === null));
  const requested = Number(q.round);
  const startAt = Number.isInteger(requested) && requested >= 1 && requested <= b.rounds.length ? requested - 1 : firstOpen;

  return (
    <div className="pt-6">
      {["CHALLENGE_SENT", "ACCEPTED", "SCHEDULED", "ACTIVE", "VOTING"].includes(b.status) && (
        <AutoRefresh deadline={deadline?.toISOString() ?? null} everyMs={live ? 15_000 : 30_000} />
      )}

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip b={b} />
          <Chip tone="muted">{b.typeLabel}</Chip>
          {b.visibility === "PRIVATE" && <Chip tone="muted">Private</Chip>}
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold uppercase leading-none sm:text-4xl">{b.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {b.theme}
          {b.era ? ` · ${b.era}` : ""}
          {b.genre ? ` · ${b.genre}` : ""}
          {b.type === "SONG_FOR_SONG" ? ` · ${b.roundCount} rounds` : b.type === "PLAYLIST" ? ` · ${b.playlistLength} tracks` : ""}
        </p>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <PlayerTag username={A.username} name={A.displayName} you={A.isYou} />
          <span className="font-display text-lg text-muted">VS</span>
          {B ? (
            <PlayerTag username={B.username} name={B.displayName} you={B.isYou} right />
          ) : (
            <div className="text-right">
              <p className="font-semibold">{b.invited ? `@${b.invited.username}` : "Open"}</p>
              <p className="text-xs text-muted">{b.invited ? "invited" : "anyone can accept"}</p>
            </div>
          )}
        </div>
      </header>

      {q.sent === "1" && b.status === "CHALLENGE_SENT" && b.viewer.side === 0 && (
        <Card className="mt-6 border-violet/50 bg-violet/10">
          <p className="font-semibold">Challenge sent 🎉</p>
          <p className="mt-1 text-sm text-muted">
            {b.mode === "DIRECT" ? `@${b.invited?.username} has been notified.` : "It's listed in open challenges. Share it to find a taker faster."}
          </p>
          <div className="mt-3">
            <ShareButton path={`/battle/${b.id}`} title={b.title} text={b.tagline ?? `Think you can beat my ${b.theme} picks?`} label="Share challenge" />
          </div>
        </Card>
      )}

      {b.status === "CHALLENGE_SENT" && (
        <Card className="mt-6">
          {b.tagline && <p className="font-display text-xl italic leading-snug">“{b.tagline}”</p>}
          <p className={`text-sm text-muted ${b.tagline ? "mt-2" : ""}`}>
            @{A.username} {b.mode === "DIRECT" ? `challenged @${b.invited?.username}` : "is waiting for a challenger"}.{" "}
            {b.expiresAt && <Countdown to={b.expiresAt.toISOString()} suffix=" left to accept." />}
          </p>
          <ChallengeActions b={b} />
          {b.viewer.canAccept && <p className="mt-2 text-center text-xs text-muted">After you accept, you&apos;ll pick your songs.</p>}
        </Card>
      )}

      {b.status === "ACCEPTED" && (
        <Card className="mt-6">
          {b.viewer.needsLineup ? (
            <>
              <p className="font-semibold">Your picks</p>
              <p className="mt-1 text-sm text-muted">
                {b.type === "SONG_FOR_SONG" ? `One song per round, in order.` : b.type === "PLAYLIST" ? "Build your playlist." : "Upload your mix."}{" "}
                {b.lineupDueAt && <Countdown to={b.lineupDueAt.toISOString()} suffix=" left." />}
              </p>
              <LineupBuilder b={b} canSearch={configured.appleMusic} canUpload={storage !== null} />
            </>
          ) : (
            <p className="text-sm text-muted">
              @{B?.username} accepted and is picking songs.{" "}
              {b.lineupDueAt && <Countdown to={b.lineupDueAt.toISOString()} prefix="They have " suffix="." />}
            </p>
          )}
          {!b.viewer.needsLineup && <ChallengeActions b={b} />}
        </Card>
      )}

      {b.status === "SCHEDULED" && b.startsAt && (
        <Card className="mt-6 text-center">
          <p className="text-xs uppercase tracking-widest text-muted">Premieres in</p>
          <p className="mt-1 font-display text-4xl font-bold">
            <Countdown to={b.startsAt.toISOString()} />
          </p>
          <p className="mt-2 text-sm text-muted">Both lineups are locked. Rounds go live then.</p>
        </Card>
      )}

      {live && b.votingEndsAt && (
        <p className="mt-6 text-center text-sm text-muted">
          Voting closes in <Countdown to={b.votingEndsAt.toISOString()} />
          {b.revealIntervalMs > 0 && b.rounds.some((r) => !r.revealed) ? ". New rounds keep dropping." : "."}
        </p>
      )}

      {b.status === "COMPLETED" && b.result && (
        <Card className="mt-6 text-center">
          <p className="text-xs uppercase tracking-widest text-muted">Final score</p>
          <p className="mt-1 font-display text-5xl font-bold tabular-nums">
            {b.result.score[0]}–{b.result.score[1]}
          </p>
          <p className="mt-1 text-sm">
            {b.result.winnerSide === null ? "It's a draw." : `@${b.players[b.result.winnerSide]!.username} wins.`}
          </p>
          <LinkButton href={`/battle/${b.id}/results`} className="mt-4">
            See full results
          </LinkButton>
        </Card>
      )}

      {b.status === "CANCELLED" && (
        <Card className="mt-6">
          <p className="font-semibold">This battle didn&apos;t happen.</p>
          <p className="mt-1 text-sm text-muted">{cancelText(b.cancelReason)}</p>
          {b.viewer.signedIn && (
            <LinkButton href="/battle/create" size="sm" className="mt-3">
              Start a new battle
            </LinkButton>
          )}
        </Card>
      )}

      {(b.status === "CHALLENGE_SENT" || b.status === "ACCEPTED" || b.status === "SCHEDULED") && b.myLineup.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-soft">Your locked picks</h2>
          <p className="mt-1 text-xs text-muted">Only you can see these until each round drops.</p>
          <ol className="mt-3 space-y-1.5">
            {b.myLineup.map((e, i) => (
              <li key={e.submissionId} className="flex gap-3 rounded-xl border border-line bg-surface-1 px-3 py-2 text-sm">
                <span className="w-6 text-muted">{i + 1}</span>
                <span className="min-w-0 truncate">
                  {e.title}
                  {e.kind === "track" && <span className="text-muted"> · {e.artistName}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(live || b.status === "COMPLETED") && <RoundStepper b={b} startAt={startAt} />}

      {b.status !== "CANCELLED" && b.status !== "CHALLENGE_SENT" && (
        <Comments battleId={b.id} comments={comments} canComment={b.viewer.canComment} signedIn={b.viewer.signedIn} />
      )}

      <p className="mt-10 text-center text-xs text-muted">
        <Link href="/battle" className="hover:text-text">
          ← All battles
        </Link>
      </p>
    </div>
  );
}

function PlayerTag({ username, name, you, right = false }: { username: string; name: string; you: boolean; right?: boolean }) {
  return (
    <Link href={`/profile/${username}`} className={`min-w-0 ${right ? "text-right" : ""}`}>
      <p className="truncate font-semibold">{name}</p>
      <p className="truncate text-xs text-muted">
        @{username}
        {you ? " · you" : ""}
      </p>
    </Link>
  );
}

function StatusChip({ b }: { b: BattleView }) {
  switch (b.status) {
    case "CHALLENGE_SENT":
      return <Chip tone="warn">Challenge</Chip>;
    case "ACCEPTED":
      return <Chip>Picking songs</Chip>;
    case "SCHEDULED":
      return <Chip>Scheduled</Chip>;
    case "ACTIVE":
    case "VOTING":
      return (
        <Chip tone="live" dot>
          Live · voting
        </Chip>
      );
    case "COMPLETED":
      return <Chip tone="win">Final</Chip>;
    default:
      return <Chip tone="muted">Called off</Chip>;
  }
}

function cancelText(reason: string | null) {
  switch (reason) {
    case "EXPIRED":
      return "Nobody accepted the challenge in time.";
    case "DECLINED":
      return "The challenge was declined.";
    case "LINEUP_MISSED":
      return "The opponent didn't lock in their picks in time.";
    case "MODERATED":
      return "This battle was removed by a moderator.";
    default:
      return "It was withdrawn.";
  }
}

async function loadComments(battleId: string, actor: Awaited<ReturnType<typeof getActor>>): Promise<CommentView[]> {
  const rows = await prisma.comment.findMany({
    where: { battleId, status: "VISIBLE" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorId: true,
      round: { select: { index: true } },
      author: { select: { profile: { select: { username: true } } } },
    },
  });
  const moderator = can(actor, { type: "comment.moderate" }).allow;
  return rows.map((c) => ({
    id: c.id,
    body: c.body,
    author: c.author.profile?.username ?? "someone",
    mine: c.authorId === actor?.id,
    canRemove: c.authorId === actor?.id || moderator,
    round: c.round?.index ?? null,
    at: c.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));
}
