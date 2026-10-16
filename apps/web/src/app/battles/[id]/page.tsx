import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AutoRefresh } from "@/components/battle/auto-refresh";
import { getActor } from "@/lib/auth/server";
import { catalogPort } from "@/lib/battles";
import { type BattleView, type PickView, type RoundView, loadBattleView } from "@/lib/battles/view";
import { timeLeft } from "@/lib/time";
import { ChallengeActions, PickPlayer, RematchButton, TrackPicker, VotingRound } from "./stage";

type Params = { params: Promise<{ id: string }> };

const load = cache(async (id: string) => {
  if (!/^[a-z0-9]{1,40}$/i.test(id)) return null;
  return loadBattleView(id, await getActor());
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const b = await load((await params).id);
  if (!b) return { title: "Not found" };
  const right = b.sides[1] ? `@${b.sides[1].handle}` : "anyone";
  return { title: `${b.theme}: @${b.sides[0].handle} vs ${right}` };
}

export default async function BattlePage({ params }: Params) {
  const b = await load((await params).id);
  if (!b) notFound();

  const current = b.rounds.at(-1);
  const live = b.status === "IN_PROGRESS" || b.status === "OPEN" || b.status === "PENDING_ACCEPT";
  const deadline =
    current && current.kind !== "closed" ? current.closesAt : live && b.status !== "IN_PROGRESS" ? b.expiresAt : null;

  return (
    <div className="pt-6">
      {live && <AutoRefresh deadline={deadline?.toISOString() ?? null} />}
      <Link href="/battles" className="text-xs text-muted hover:text-text">
        ← Battles
      </Link>

      <header className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-soft">{b.ruleSummary}</p>
        <h1 className="mt-1 font-display text-4xl font-bold uppercase leading-none">{b.theme}</h1>
      </header>

      <Scoreboard b={b} />

      {(b.status === "OPEN" || b.status === "PENDING_ACCEPT") && <Pending b={b} />}
      {b.status === "CANCELLED" && <Notice>This battle was called off.</Notice>}
      {b.status === "EXPIRED" && <Notice>Nobody accepted this challenge in time.</Notice>}
      {b.status === "COMPLETE" && <Result b={b} />}

      {current && current.kind !== "closed" && (
        <section aria-label="Current round" className="mt-6">
          <RoundHeading round={current} total={b.rules.roundCount} />
          {current.kind === "voting" ? (
            <VotingRound battleId={b.id} round={current} />
          ) : (
            <Picking b={b} round={current} />
          )}
        </section>
      )}

      {b.rounds.some((r) => r.kind === "closed") && (
        <section aria-label="Results by round" className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-soft">Rounds</h2>
          <ol className="mt-3 space-y-3">
            {b.rounds
              .filter((r): r is Extract<RoundView, { kind: "closed" }> => r.kind === "closed")
              .reverse()
              .map((r) => (
                <ClosedRound key={r.index} r={r} b={b} />
              ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Scoreboard({ b }: { b: BattleView }) {
  const [left, right] = b.sides;
  const done = b.status === "COMPLETE";
  const tone = (s: 0 | 1) =>
    done && b.winnerSide !== null ? (b.winnerSide === s ? "text-win" : "text-lose") : "text-text";
  return (
    <section aria-label="Score" className="mt-5 rounded-2xl border border-line bg-surface-1 p-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="min-w-0">
          <Link href={`/u/${left.handle}`} className="block truncate text-sm text-muted hover:text-text">
            @{left.handle}
            {b.viewer.side === 0 && <span className="ml-1 text-xs text-violet-soft">(you)</span>}
          </Link>
          <p className={`font-display text-5xl font-bold tabular-nums ${tone(0)}`}>{b.roundsWon[0]}</p>
        </div>
        <span className="font-display text-lg text-muted">VS</span>
        <div className="min-w-0 text-right">
          {right ? (
            <Link href={`/u/${right.handle}`} className="block truncate text-sm text-muted hover:text-text">
              {b.viewer.side === 1 && <span className="mr-1 text-xs text-violet-soft">(you)</span>}@{right.handle}
            </Link>
          ) : (
            <p className="truncate text-sm text-muted">{b.invited ? `@${b.invited.handle}?` : "Open"}</p>
          )}
          <p className={`font-display text-5xl font-bold tabular-nums ${tone(1)}`}>{b.roundsWon[1]}</p>
        </div>
      </div>
      <RoundTrack b={b} />
    </section>
  );
}

/** One pip per round: who took it, or what's happening now. */
function RoundTrack({ b }: { b: BattleView }) {
  const regular = Array.from({ length: b.rules.roundCount }, (_, i) => b.rounds.find((r) => r.index === i));
  const extra = b.rounds.filter((r) => r.suddenDeath);
  return (
    <ol className="mt-4 flex gap-1.5" aria-label="Rounds">
      {[...regular, ...extra].map((r, i) => {
        const label = r?.suddenDeath ? "Sudden death" : `Round ${i + 1}`;
        let cls = "bg-surface-3";
        let state = "not started";
        if (r?.kind === "closed") {
          if (r.winnerSide === null) [cls, state] = ["bg-muted/40", r.outcome === "VOID" ? "no picks" : "tied"];
          else [cls, state] = [r.winnerSide === 0 ? "bg-violet" : "bg-violet-soft", `won by @${b.sides[r.winnerSide]?.handle}`];
        } else if (r) [cls, state] = ["bg-live animate-pulse", r.kind === "voting" ? "voting now" : "picking now"];
        return <li key={i} title={`${label}: ${state}`} aria-label={`${label}: ${state}`} className={`h-1.5 flex-1 rounded-full ${cls}`} />;
      })}
    </ol>
  );
}

function RoundHeading({ round, total }: { round: Exclude<RoundView, { kind: "closed" }>; total: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-display text-2xl font-bold uppercase">
        {round.suddenDeath ? "Sudden death" : `Round ${round.index + 1}`}
        {!round.suddenDeath && <span className="ml-2 text-base text-muted">of {total}</span>}
      </h2>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-live">
        <span className="size-1.5 rounded-full bg-live" aria-hidden />
        {round.kind === "voting" ? "Voting" : "Picking"} · {timeLeft(round.closesAt)}
      </p>
    </div>
  );
}

function Picking({ b, round }: { b: BattleView; round: Extract<RoundView, { kind: "picking" }> }) {
  const me = b.viewer.side;
  if (me === null) {
    const who = (s: 0 | 1) => `@${b.sides[s]?.handle}`;
    return (
      <div className="mt-3 rounded-2xl border border-line bg-surface-1 p-4 text-sm text-muted">
        <p>Both battlers are choosing their tracks. Voting opens as soon as both have picked.</p>
        <ul className="mt-3 space-y-1">
          {([0, 1] as const).map((s) => (
            <li key={s}>
              {who(s)}: {round.picked[s] ? <span className="text-text">picked</span> : "still choosing"}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const opponent = b.sides[me === 0 ? 1 : 0];
  if (round.myPick) {
    return (
      <div className="mt-3 rounded-2xl border border-line bg-surface-1 p-4">
        <p className="text-xs uppercase tracking-widest text-muted">Your pick</p>
        <PickLine pick={round.myPick} />
        <p className="mt-3 text-sm text-muted">
          Waiting for @{opponent?.handle}. If they don&apos;t pick in time, you take the round.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">
        Pick your track for this round. @{opponent?.handle} won&apos;t see it until voting opens.
        {b.rules.eraFrom !== null || b.rules.eraTo !== null ? " It has to fit the era." : ""} Each track can only be
        played once per battle.
      </p>
      {catalogPort ? (
        <TrackPicker battleId={b.id} roundIndex={round.index} />
      ) : (
        <Notice>Track search isn&apos;t available right now.</Notice>
      )}
    </div>
  );
}

function ClosedRound({ r, b }: { r: Extract<RoundView, { kind: "closed" }>; b: BattleView }) {
  const total = r.votes[0] + r.votes[1];
  const note =
    r.outcome === "FORFEIT"
      ? `@${b.sides[r.winnerSide === 0 ? 1 : 0]?.handle} didn't pick in time`
      : r.outcome === "VOID"
        ? "Neither side picked in time"
        : total === 0
          ? "No votes"
          : r.winnerSide === null
            ? "Tied"
            : null;
  return (
    <li className="rounded-2xl border border-line bg-surface-1 p-4">
      <div className="flex items-baseline justify-between text-xs uppercase tracking-widest text-muted">
        <span>{r.suddenDeath ? "Sudden death" : `Round ${r.index + 1}`}</span>
        {note && <span className="normal-case tracking-normal">{note}</span>}
      </div>
      <div className="mt-3 space-y-3">
        {([0, 1] as const).map((s) => {
          const pick = r.picks[s];
          const share = total ? Math.round((r.votes[s] / total) * 100) : 0;
          const won = r.winnerSide === s;
          return (
            <div key={s} className={won ? "" : "opacity-70"}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className={won ? "font-semibold text-win" : "text-muted"}>
                  @{b.sides[s]?.handle}
                  {won && " · won"}
                </span>
                {r.outcome === "VOTES" && (
                  <span className="tabular-nums text-muted">
                    {r.votes[s]} {r.votes[s] === 1 ? "vote" : "votes"} · {share}%
                  </span>
                )}
              </div>
              {pick ? <PickPlayer pick={pick} /> : <p className="mt-1 text-sm text-muted">No pick</p>}
              {r.outcome === "VOTES" && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                  <div className={`h-full ${won ? "bg-win" : "bg-violet"}`} style={{ width: `${share}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </li>
  );
}

function Pending({ b }: { b: BattleView }) {
  const message =
    b.status === "OPEN"
      ? `Open challenge from @${b.sides[0].handle}. The first person to accept takes them on.`
      : `@${b.sides[0].handle} challenged @${b.invited?.handle}.`;
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface-1 p-4">
      <p className="text-sm">{message}</p>
      <p className="mt-1 text-xs text-muted">Expires in {timeLeft(b.expiresAt).replace(" left", "")}.</p>
      <ChallengeActions
        battleId={b.id}
        canAccept={b.viewer.canAccept}
        canCancel={b.viewer.canCancel}
        isCreator={b.viewer.side === 0}
        signedIn={b.viewer.signedIn}
      />
    </section>
  );
}

function Result({ b }: { b: BattleView }) {
  const winner = b.winnerSide === null ? null : b.sides[b.winnerSide];
  const mine = b.viewer.side;
  const headline =
    winner === null
      ? "It's a draw"
      : mine === null
        ? `@${winner.handle} wins`
        : b.winnerSide === mine
          ? "You won"
          : `@${winner.handle} won`;
  const decidedOnVotes =
    winner !== null && b.roundsWon[0] === b.roundsWon[1] && !b.rounds.some((r) => r.kind === "closed" && r.suddenDeath && r.winnerSide !== null);
  return (
    <section className="mt-6 rounded-2xl border border-win/40 bg-plum/60 p-5 text-center">
      <p className="font-display text-3xl font-bold uppercase text-win">{headline}</p>
      <p className="mt-1 text-sm text-muted">
        {b.roundsWon[0]}–{b.roundsWon[1]} on rounds
        {decidedOnVotes ? `, decided on total votes (${b.totalVotes[0]}–${b.totalVotes[1]})` : ""}
      </p>
      {mine !== null && <RematchButton battleId={b.id} existingId={b.rematchId} />}
    </section>
  );
}

function PickLine({ pick }: { pick: PickView }) {
  return (
    <div className="mt-2 flex items-center gap-3">
      {pick.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- provider-hosted art, shown as-is
        <img src={pick.artworkUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="size-12 shrink-0 rounded-md bg-surface-3" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="truncate font-medium">{pick.title}</p>
        <p className="truncate text-sm text-muted">
          {pick.artistName}
          {pick.releaseYear ? ` · ${pick.releaseYear}` : ""}
        </p>
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 rounded-2xl border border-line bg-surface-1 p-4 text-sm text-muted">{children}</p>;
}
