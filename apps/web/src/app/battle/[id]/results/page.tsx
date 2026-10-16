import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { FollowButton } from "@/components/social/follow-button";
import { LinkButton } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ShareButton } from "@/components/ui/share-button";
import { getActor } from "@/lib/auth/server";
import { type EntryView, loadBattleView } from "@/lib/battles/view";

type Params = { params: Promise<{ id: string }> };

const load = cache(async (id: string) => {
  if (!/^[a-z0-9]{1,40}$/i.test(id)) return null;
  return loadBattleView(id, await getActor());
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const b = await load((await params).id);
  if (!b?.result) return { title: "Results" };
  const [A, B] = b.players;
  return {
    title: `Results: ${b.title}`,
    description: `@${A.username} ${b.result.score[0]}–${b.result.score[1]} @${B?.username}. ${b.theme}.`,
  };
}

const label = (e: EntryView | null) => (!e ? "—" : e.kind === "track" ? e.title : e.title);
const sub = (e: EntryView | null) => (!e ? "" : e.kind === "track" ? e.artistName : e.kind === "playlist" ? `${e.tracks.length} tracks` : "DJ mix");

export default async function ResultsPage({ params }: Params) {
  const { id } = await params;
  const [b, actor] = await Promise.all([load(id), getActor()]);
  if (!b) notFound();
  if (b.status !== "COMPLETED" || !b.result) redirect(`/battle/${b.id}`);

  const r = b.result;
  const [A, B] = [b.players[0], b.players[1]!];
  const winner = r.winnerSide === null ? null : b.players[r.winnerSide]!;
  const isPlayer = b.viewer.side !== null;
  const others = [A, B].filter((p) => p.userId !== actor?.id);
  const follows = actor
    ? new Set(
        (
          await prisma.follow.findMany({
            where: { followerId: actor.id, followeeId: { in: others.map((p) => p.userId) } },
            select: { followeeId: true },
          })
        ).map((f) => f.followeeId),
      )
    : new Set<string>();
  const shareText = winner
    ? `@${winner.username} won ${r.score[r.winnerSide!]}–${r.score[r.winnerSide === 0 ? 1 : 0]} in "${b.title}" on VYBZ.`
    : `"${b.title}" ended in a ${r.score[0]}–${r.score[1]} draw on VYBZ.`;

  return (
    <div className="pt-6">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-violet-soft">Final score</p>
      <h1 className="sr-only">Results: {b.title}</h1>
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
        <Side name={A.displayName} username={A.username} score={r.score[0]} won={r.winnerSide === 0} />
        <span className="font-display text-xl text-muted">–</span>
        <Side name={B.displayName} username={B.username} score={r.score[1]} won={r.winnerSide === 1} />
      </div>
      <p className="mt-5 text-center font-display text-2xl font-bold uppercase">
        {winner ? (
          <>
            🏆 @{winner.username} wins{winner.isYou ? " (you!)" : ""}
          </>
        ) : (
          "It's a draw"
        )}
      </p>
      <p className="mt-1 text-center text-sm text-muted">
        {b.title} · {b.theme} · {r.totalVoters} {r.totalVoters === 1 ? "voter" : "voters"} · {r.totalVotes[0] + r.totalVotes[1]} votes
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {isPlayer &&
          (b.rematchId ? (
            <LinkButton href={`/battle/${b.rematchId}`}>See the rematch</LinkButton>
          ) : (
            <LinkButton href={`/battle/create?rematch=${b.id}`}>Rematch</LinkButton>
          ))}
        <ShareButton path={`/battle/${b.id}/results`} title={`Results: ${b.title}`} text={shareText} label="Share results" />
        {actor &&
          others.map((p) => (
            <FollowButton key={p.userId} username={p.username} following={follows.has(p.userId)} />
          ))}
      </div>

      {r.crowdFavorite && (
        <Card className="mt-8 border-violet/50">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-soft">Crowd favorite</p>
          <p className="mt-2 font-display text-xl font-bold">{r.crowdFavorite.title}</p>
          <p className="text-sm text-muted">
            {r.crowdFavorite.subtitle} · picked by @{b.players[r.crowdFavorite.side]!.username}
            {b.roundCount > 1 ? ` · round ${r.crowdFavorite.roundIndex + 1}` : ""} · {r.crowdFavorite.votes} votes
          </p>
        </Card>
      )}

      <section className="mt-8 space-y-3">
        <SectionTitle>Round by round</SectionTitle>
        <ol className="space-y-2">
          {b.rounds.map((round) => {
            const v = round.votes ?? [0, 0];
            const total = v[0] + v[1];
            const pctA = total ? Math.round((v[0] / total) * 100) : 50;
            return (
              <li key={round.index}>
                <Link href={`/battle/${b.id}?round=${round.index + 1}`} className="block rounded-2xl border border-line bg-surface-1 p-3 hover:border-violet">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span className="font-semibold uppercase tracking-wider">{b.roundCount > 1 ? `Round ${round.index + 1}` : b.typeLabel}</span>
                    {round.winnerSide === null ? <Chip tone="muted">Tie</Chip> : <Chip tone="win">@{b.players[round.winnerSide]!.username}</Chip>}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                    <div className={`min-w-0 ${round.winnerSide === 0 ? "" : "opacity-70"}`}>
                      <p className="truncate font-medium">{label(round.entries[0])}</p>
                      <p className="truncate text-xs text-muted">{sub(round.entries[0])}</p>
                    </div>
                    <div className={`min-w-0 text-right ${round.winnerSide === 1 ? "" : "opacity-70"}`}>
                      <p className="truncate font-medium">{label(round.entries[1])}</p>
                      <p className="truncate text-xs text-muted">{sub(round.entries[1])}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs tabular-nums">
                    <span className="w-6">{v[0]}</span>
                    <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full bg-violet" style={{ width: `${pctA}%` }} />
                    </div>
                    <span className="w-6 text-right">{v[1]}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <p className="mt-10 text-center text-xs text-muted">
        <Link href={`/battle/${b.id}`} className="hover:text-text">
          ← Back to the battle
        </Link>
      </p>
    </div>
  );
}

function Side({ name, username, score, won }: { name: string; username: string; score: number; won: boolean }) {
  return (
    <Link href={`/profile/${username}`} className="min-w-0">
      <p className={`font-display text-6xl font-bold tabular-nums ${won ? "text-win" : ""}`}>{score}</p>
      <p className="mt-1 truncate font-semibold">{name}</p>
      <p className="truncate text-xs text-muted">@{username}</p>
    </Link>
  );
}
