"use client";

import { type BattleView, type EntryView, type LiveView, REACTIONS, type RoundView } from "@vybz/core";
import { useEffect, useState } from "react";

const SIDES = ["#8B5CF6", "#F472B6", "#22D3EE", "#FBBF24", "#34D399", "#FB7185", "#60A5FA", "#A3E635"];

function useNow(ms: number) {
  // 0 until mounted, so server and client render the same first frame.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function left(iso: string | null, now: number): string | null {
  if (!iso || !now) return null;
  const s = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Live view for a big screen or a stream overlay. Polls the battle every 5s and chat every 3s. */
export function WatchParty({ initial, code, qrSvg, link }: { initial: BattleView; code: string | null; qrSvg: string; link: string }) {
  const [b, setB] = useState(initial);
  const [live, setLive] = useState<LiveView | null>(null);
  const now = useNow(1000);
  const q = code ? `?code=${encodeURIComponent(code)}` : "";

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const r = await fetch(`/api/v1/battles/${b.id}${q}`, { cache: "no-store" }).catch(() => null);
      if (alive && r?.ok) setB(await r.json());
    };
    const t = setInterval(() => void pull(), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [b.id, q]);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const r = await fetch(`/api/v1/battles/${b.id}/live`, { cache: "no-store" }).catch(() => null);
      if (alive && r?.ok) setLive(await r.json());
    };
    void pull();
    const t = setInterval(() => void pull(), 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [b.id]);

  const players = [...b.participants].sort((x, y) => x.side - y.side);
  const round: RoundView | undefined = b.currentRoundIndex !== null ? b.rounds[b.currentRoundIndex] : b.rounds.filter((r) => r.status === "SCORED").at(-1);
  const handle = (pid: string | null) => b.participants.find((p) => p.id === pid)?.user.handle ?? null;
  const winner = handle(b.winnerParticipantId);
  const lastScored = b.rounds.filter((r) => r.status === "SCORED" && r.index !== round?.index).at(-1);

  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-6 bg-ink p-8 text-white" style={{ background: "linear-gradient(135deg,#0A0614 0%,#1E0B3A 60%,#3B0F6B 100%)" }}>
      <header className="flex items-center justify-between">
        <div className="flex items-baseline gap-4">
          <span className="font-display text-3xl font-bold tracking-[0.3em]">VYBZ</span>
          <span className="text-lg text-muted">Watch party</span>
        </div>
        <div className="flex items-center gap-6 text-lg">
          {live ? <span className="text-muted">👀 {live.viewers} watching</span> : null}
          <StatusPill b={b} round={round} now={now} winner={winner} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-6">
        <main className="flex min-w-0 flex-1 flex-col gap-6">
          <div>
            <h1 className="text-5xl font-bold leading-tight">{b.title}</h1>
            {b.theme ? <p className="mt-1 text-2xl text-muted">{b.theme}</p> : null}
          </div>

          <div className="flex flex-wrap items-center gap-6">
            {players.map((p, i) => (
              <div key={p.id} className="flex items-center gap-6">
                {i > 0 ? <span className="text-3xl font-bold text-muted">vs</span> : null}
                <div className={`flex items-center gap-4 rounded-2xl border-2 px-5 py-3 ${p.id === b.winnerParticipantId ? "border-violet-soft" : "border-white/10"} bg-white/5`}>
                  <span className="flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold" style={{ border: `4px solid ${SIDES[p.side % SIDES.length]}`, background: "#2A0E4F" }}>
                    {(p.user.displayName || p.user.handle).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-2xl font-bold">@{p.user.handle}</span>
                  {b.status !== "OPEN_CHALLENGE" ? <span className="font-display text-5xl font-bold">{p.roundsWon}</span> : null}
                </div>
              </div>
            ))}
          </div>

          {round ? <RoundPanel round={round} b={b} handle={handle} /> : <p className="text-2xl text-muted">Waiting for the battle to start…</p>}
          {round && round.status !== "SCORED" && lastScored ? (
            <>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-muted">
                Last round · {lastScored.winnerParticipantId ? `@${handle(lastScored.winnerParticipantId)} took it` : "draw"}
              </p>
              <RoundPanel round={lastScored} b={b} handle={handle} />
            </>
          ) : null}
        </main>

        <aside className="flex w-[360px] shrink-0 flex-col gap-4">
          <div className="flex items-center gap-4 rounded-2xl bg-white p-4 text-ink">
            <div className="h-32 w-32 shrink-0" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <div>
              <p className="text-xl font-bold">Scan to listen and vote</p>
              <p className="mt-1 break-all text-sm opacity-70">{link}</p>
            </div>
          </div>
          <div className="flex justify-between rounded-2xl bg-white/5 px-4 py-3 text-2xl">
            {REACTIONS.map((r) => (
              <span key={r} className="flex flex-col items-center">
                <span className={live?.recentReactions[r] ? "animate-bounce" : ""}>{r}</span>
                <span className="text-sm text-muted">{live?.reactionTotals[r] ?? 0}</span>
              </span>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white/5 p-4">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-muted">Chat</p>
            <ul className="mt-2 flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden text-lg">
              {(live?.messages ?? []).slice(-12).map((m) => (
                <li key={m.id}>
                  <span className="font-bold text-violet-soft">@{m.user.handle}</span> {m.body}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StatusPill({ b, round, now, winner }: { b: BattleView; round: RoundView | undefined; now: number; winner: string | null }) {
  let text = "";
  if (b.status === "COMPLETE") text = winner ? `🏆 @${winner} wins` : "Ended level";
  else if (b.status === "IN_PROGRESS" && round) {
    const t = left(round.status === "VOTING_OPEN" ? round.votingClosesAt : round.submissionsCloseAt, now);
    text = `Round ${round.index + 1}/${b.rounds.length} · ${round.status === "VOTING_OPEN" ? "Voting" : "Picking"}${t ? ` · ${t}` : ""}`;
  } else if (b.status === "OPEN_CHALLENGE") text = "Open challenge";
  else text = b.status.replace("_", " ").toLowerCase();
  return <span className="rounded-full border-2 border-violet px-4 py-1 font-bold">{text}</span>;
}

function RoundPanel({ round, b, handle }: { round: RoundView; b: BattleView; handle: (pid: string | null) => string | null }) {
  if (round.status === "SUBMISSIONS_OPEN" || round.status === "PENDING") {
    return (
      <div className="rounded-2xl bg-white/5 p-6">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-muted">Round {round.index + 1}</p>
        <p className="mt-2 text-3xl font-bold">Picks are sealed until everyone&apos;s in…</p>
      </div>
    );
  }
  const total = round.totalVotes;
  return (
    <div className="grid items-start gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(round.entries.length, 4)}, minmax(0, 1fr))` }}>
      {round.entries.map((e, i) => (
        <Entry key={e.submissionId} e={e} index={i} round={round} total={total} who={handle(e.participantId)} won={round.status === "SCORED" && e.participantId === round.winnerParticipantId} />
      ))}
    </div>
  );
}

function Entry({ e, index, round, total, who, won }: { e: EntryView; index: number; round: RoundView; total: number | null; who: string | null; won: boolean }) {
  const pct = total && e.votes ? Math.round((e.votes.count / total) * 100) : null;
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border-2 bg-white/5 p-5 ${won ? "border-violet-soft" : "border-transparent"}`}>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-muted">{who ? `@${who}` : `Pick ${String.fromCharCode(65 + index)}`}{won ? " · wins the round" : ""}</p>
      {e.tracks.map((t) => (
        <div key={t.submissionId} className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {t.track.artworkUrl ? <img src={t.track.artworkUrl} alt="" className="h-24 w-24 rounded-xl" /> : <span className="h-24 w-24 rounded-xl bg-white/10" />}
          <div className="min-w-0">
            <p className="truncate text-2xl font-bold">{t.track.title}</p>
            <p className="truncate text-xl text-muted">
              {t.track.artistName}
              {t.track.releaseYear ? ` · ${t.track.releaseYear}` : ""}
            </p>
          </div>
        </div>
      ))}
      {pct !== null ? (
        <div className="mt-auto">
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div className="h-3 bg-violet" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-lg font-bold">
            {pct}% · {e.votes!.count} votes
          </p>
        </div>
      ) : round.status === "VOTING_OPEN" ? (
        <p className="mt-auto text-lg text-muted">Votes are hidden until the round closes</p>
      ) : null}
      {round.ai && round.ai.submissionId === e.submissionId && round.status === "SCORED" ? <p className="text-base text-muted">AI judge: {round.ai.reason}</p> : null}
    </div>
  );
}
