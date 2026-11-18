"use client";

import { GENRES, PARTY_GAMES, type PartyCreated, type PartyGame, type PartyHostView, genreLabel, partyCodeLabel } from "@vybz/core";
import { useEffect, useRef, useState } from "react";
import { CHOICE_COLORS, CHOICE_SHAPES, hostKeyName, partyCall, readKey, useCountdown, usePoll, writeKey } from "./client";

/** /party: name the party, pick a theme, get a code. */
export function PartyStart() {
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await partyCall<PartyCreated>("/api/v1/party", null, { method: "POST", body: { title: title.trim() || undefined, genre } });
      writeKey(hostKeyName(c.code), c.hostKey);
      window.location.href = `/party/host/${c.code}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-12" data-embed="app">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-violet-soft">Vybz Party Mode</div>
        <h1 className="font-display text-5xl font-black">Host a party</h1>
        <p className="mt-2 text-muted">Put this screen on a TV or laptop. Guests join on their phones by scanning a QR code; no app or account needed.</p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">Party name</span>
        <input value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={40} placeholder="Friday Night R&B" className="rounded-xl border border-line bg-surface-1 px-4 py-3 text-xl" />
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">Theme (optional)</span>
        <div className="flex flex-wrap gap-2">
          {[{ key: null as string | null, label: "Anything goes" }, ...GENRES.map((g) => ({ key: g.key as string | null, label: g.label }))].map((g) => (
            <button key={g.key ?? "any"} type="button" onClick={() => setGenre(g.key)} aria-pressed={genre === g.key} className={`rounded-full border px-4 py-2 text-sm font-bold ${genre === g.key ? "border-violet bg-plum" : "border-line bg-surface-1 text-muted"}`}>
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" onClick={() => void start()} disabled={busy} className="rounded-2xl bg-violet px-6 py-4 text-xl font-black text-white disabled:opacity-50">
        {busy ? "Setting up…" : "Start the party"}
      </button>
      {error ? <p className="text-[#FF6B8A]">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(PARTY_GAMES) as PartyGame[]).map((g) => (
          <div key={g} className="rounded-xl border border-line bg-surface-1 p-3">
            <div className="font-bold">
              {PARTY_GAMES[g].icon} {PARTY_GAMES[g].label}
            </div>
            <div className="text-sm text-muted">{PARTY_GAMES[g].blurb}</div>
          </div>
        ))}
      </div>
      <a href="/p" className="text-center text-sm text-muted underline">
        Joining someone else's party? Enter the code
      </a>
    </div>
  );
}

/** The big screen. Polls once a second and runs the room. */
export function PartyHost({ code }: { code: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setKey(readKey(hostKeyName(code)));
    setReady(true);
  }, [code]);
  const poll = usePoll<PartyHostView>(ready ? () => partyCall(`/api/v1/party/${code}/host`, key) : null, 1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = poll.data;
  const left = useCountdown(v?.deadline ?? null, v?.serverNow ?? null);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      poll.setData(await partyCall<PartyHostView>(`/api/v1/party/${code}/host`, key, { method: "POST", body }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "n" || e.key === "N") && v && !["LOBBY", "SCORES", "FINAL"].includes(v.phase)) void act({ action: "next" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!ready) return null;
  if (poll.error && !v) {
    return (
      <div className="py-20 text-center" data-embed="app">
        <p className="text-2xl font-bold">{poll.error.code === "NOT_HOST" ? "This screen isn't the host for that party." : poll.error.message}</p>
        <a href="/party" className="mt-4 inline-block underline">
          Host a new party
        </a>
      </div>
    );
  }
  if (!v) return <div className="py-20 text-center text-muted" data-embed="app">Loading the party…</div>;

  const live = !["LOBBY", "SCORES", "FINAL"].includes(v.phase);
  return (
    <div className="grid min-h-dvh gap-6 py-6 lg:grid-cols-[1fr_320px]" data-embed="app">
      <main className="flex flex-col gap-5">
        <header className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-violet-soft">Vybz Party Mode</div>
            <h1 className="font-display text-4xl font-black">{v.title}</h1>
            <div className="text-muted">
              {v.players.length} player{v.players.length === 1 ? "" : "s"}
              {v.game ? ` · ${PARTY_GAMES[v.game].label}` : ""}
              {v.rounds && live ? ` · Round ${v.round} of ${v.rounds}` : ""}
              {v.genre ? ` · ${genreLabel(v.genre)}` : ""}
            </div>
          </div>
          {live ? <span className="ml-auto rounded-full border border-live px-3 py-1 text-sm font-black text-live">● LIVE</span> : null}
          {live && left !== null ? (
            <span className="font-mono text-5xl font-black tabular-nums" aria-label={`${left} seconds left`}>
              {left}
            </span>
          ) : null}
        </header>

        {v.phase === "LOBBY" || v.phase === "SCORES" ? <GamePicker v={v} busy={busy} act={act} /> : null}
        {v.phase === "QUESTION" || v.phase === "REVEAL" ? <QuestionStage v={v} /> : null}
        {v.playlist && ["PICKING", "VOTING", "RESULT"].includes(v.phase) ? <PlaylistStage v={v} /> : null}
        {v.phase === "SCORES" || v.phase === "FINAL" ? <Podium v={v} /> : null}

        {error ? <p className="text-[#FF6B8A]">{error}</p> : null}
        <div className="mt-auto flex flex-wrap gap-2">
          {live ? (
            <button type="button" onClick={() => void act({ action: "next" })} disabled={busy} className="rounded-xl border border-line bg-surface-2 px-4 py-2 font-bold">
              Next ▶ <span className="text-xs text-muted">(N)</span>
            </button>
          ) : null}
          {v.phase !== "FINAL" ? (
            <button type="button" onClick={() => confirm("End the party for everyone?") && void act({ action: "end" })} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-muted">
              End party
            </button>
          ) : (
            <a href="/party" className="rounded-xl bg-violet px-4 py-2 font-bold text-white">
              Host another party
            </a>
          )}
        </div>
      </main>
      <aside className="flex flex-col gap-4">
        <JoinCard v={v} />
        <section className="rounded-2xl border border-line bg-surface-1 p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{live ? "Scores" : "Players"}</h2>
          <ol className="flex flex-col gap-1">
            {v.standings.map((p, i) => (
              <li key={p.id} className="group flex items-center gap-2">
                <span className="w-6 text-right text-sm text-muted">{i + 1}</span>
                <span className={`h-2 w-2 rounded-full ${p.online ? "bg-live" : "bg-lose"}`} aria-label={p.online ? "online" : "offline"} />
                <span className="flex-1 truncate font-bold">
                  {p.name} {p.isMember ? <span className="text-xs text-violet-soft">VYBZ</span> : null}
                </span>
                {live && p.done ? <span className="text-xs text-live">✓</span> : null}
                <span className="font-mono tabular-nums">{p.score}</span>
                {v.phase === "LOBBY" ? (
                  <button type="button" onClick={() => void act({ action: "kick", playerId: p.id })} className="hidden text-xs text-muted underline group-hover:inline" aria-label={`Remove ${p.name}`}>
                    remove
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {!v.standings.length ? <p className="text-sm text-muted">Waiting for players to join…</p> : null}
        </section>
      </aside>
    </div>
  );
}

function JoinCard({ v }: { v: PartyHostView }) {
  const [copied, setCopied] = useState(false);
  const label = partyCodeLabel(v.code);
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-violet bg-plum/40 p-4 text-center">
      <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-violet-soft">Join the party</h2>
      <div className="w-44 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: v.qrSvg }} role="img" aria-label={`QR code to join: ${v.joinUrl}`} />
      <div className="font-mono text-4xl font-black tracking-wider">{label}</div>
      <div className="text-xs text-muted">{v.joinUrl.replace(/^https?:\/\//, "")}</div>
      <button
        type="button"
        className="rounded-lg border border-line px-3 py-1 text-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(v.joinUrl);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </section>
  );
}

function GamePicker({ v, busy, act }: { v: PartyHostView; busy: boolean; act: (b: Record<string, unknown>) => Promise<void> }) {
  const [rounds, setRounds] = useState<Record<string, number>>({});
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xl font-black">{v.phase === "SCORES" ? "Play another?" : "Pick a game"}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {v.games.map((g) => (
          <div key={g.game} className={`flex flex-col gap-2 rounded-2xl border p-4 ${g.available ? "border-line bg-surface-1" : "border-line/50 bg-surface-1/40 opacity-60"}`}>
            <div className="text-xl font-black">
              {g.icon} {g.label}
            </div>
            <p className="text-sm text-muted">{g.available ? g.blurb : g.reason}</p>
            {g.available ? (
              <div className="mt-auto flex flex-wrap items-center gap-2">
                {g.rounds.map((r) => (
                  <button key={r} type="button" aria-pressed={(rounds[g.game] ?? g.rounds[0]) === r} onClick={() => setRounds((x) => ({ ...x, [g.game]: r }))} className={`rounded-full border px-3 py-1 text-sm ${(rounds[g.game] ?? g.rounds[0]) === r ? "border-violet bg-plum" : "border-line"}`}>
                    {r} {g.game === "PLAYLIST" ? (r === 1 ? "battle" : "battles") : "questions"}
                  </button>
                ))}
                <button type="button" disabled={busy} onClick={() => void act({ action: "start", game: g.game, rounds: rounds[g.game] ?? g.rounds[0] })} className="ml-auto rounded-xl bg-violet px-4 py-2 font-black text-white disabled:opacity-50">
                  Start ▶
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function QuestionStage({ v }: { v: PartyHostView }) {
  const q = v.question;
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (v.phase === "QUESTION" && q?.audioUrl) void audio.current?.play().catch(() => undefined);
    if (v.phase === "REVEAL") audio.current?.pause();
  }, [v.phase, q?.audioUrl, v.round]);
  if (!q) return null;
  const total = v.reveal ? v.reveal.counts.reduce((a, b) => a + b, 0) : 0;
  return (
    <section className="flex flex-col gap-5">
      <div className="text-sm font-bold uppercase tracking-[0.25em] text-violet-soft">{v.game === "NAME_THAT_SONG" ? "Name That Song" : "Name That Hit"}</div>
      <div className="flex items-start gap-5">
        {q.imageUrl ? <img src={q.imageUrl} alt="Album cover" className="h-48 w-48 rounded-xl object-cover" /> : null}
        <h2 className="text-4xl font-black leading-tight md:text-5xl">{q.prompt}</h2>
      </div>
      {q.audioUrl ? <audio ref={audio} src={q.audioUrl} controls className="w-full" /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {q.choices.map((c, i) => {
          const right = v.reveal?.answerIndex === i;
          const count = v.reveal?.counts[i] ?? 0;
          return (
            <div
              key={c}
              className="relative overflow-hidden rounded-2xl border-2 p-5 text-2xl font-black transition"
              style={{ borderColor: CHOICE_COLORS[i], background: v.reveal ? (right ? `${CHOICE_COLORS[i]}55` : "transparent") : `${CHOICE_COLORS[i]}22`, opacity: v.reveal && !right ? 0.45 : 1 }}
            >
              {v.reveal ? <div className="absolute inset-y-0 left-0 opacity-25" style={{ width: `${total ? (100 * count) / total : 0}%`, background: CHOICE_COLORS[i] }} /> : null}
              <span className="relative">
                <span className="mr-3" style={{ color: CHOICE_COLORS[i] }}>
                  {CHOICE_SHAPES[i]}
                </span>
                {c}
                {v.reveal ? <span className="float-right font-mono text-lg">{count}</span> : null}
                {right ? <span className="ml-2">✓</span> : null}
              </span>
            </div>
          );
        })}
      </div>
      {v.phase === "QUESTION" ? (
        <p className="text-xl text-muted">
          {v.answered} of {v.players.length} answered · answer on your phone
        </p>
      ) : (
        <p className="text-xl">
          {v.reveal?.explanation}
          {v.reveal?.fastest ? <span className="ml-2 text-live">⚡ Fastest: {v.reveal.fastest}</span> : null}
        </p>
      )}
    </section>
  );
}

function SongCard({ side, name, song, votes, winner }: { side: "A" | "B"; name: string; song: { title: string; artistName: string; releaseYear: number | null; artworkUrl: string | null } | null; votes: number | null; winner: boolean }) {
  return (
    <div className={`flex flex-1 flex-col gap-3 rounded-2xl border-2 p-4 ${winner ? "border-live" : "border-line"} bg-surface-1`}>
      <div className="text-sm font-bold uppercase tracking-wider" style={{ color: side === "A" ? CHOICE_COLORS[0] : CHOICE_COLORS[1] }}>
        {side} · {name}
      </div>
      {song ? (
        <>
          {song.artworkUrl ? <img src={song.artworkUrl} alt="" className="aspect-square w-full max-w-64 rounded-xl object-cover" /> : <div className="aspect-square w-full max-w-64 rounded-xl bg-surface-3" />}
          <div className="text-3xl font-black leading-tight">{song.title}</div>
          <div className="text-xl text-muted">
            {song.artistName}
            {song.releaseYear ? ` · ${song.releaseYear}` : ""}
          </div>
        </>
      ) : (
        <div className="py-10 text-2xl text-muted">Picking…</div>
      )}
      {votes !== null ? (
        <div className="text-4xl font-black">
          {votes} vote{votes === 1 ? "" : "s"} {winner ? "🏆" : ""}
        </div>
      ) : null}
    </div>
  );
}

function PlaylistStage({ v }: { v: PartyHostView }) {
  const pl = v.playlist!;
  return (
    <section className="flex flex-col gap-4">
      <div className="text-sm font-bold uppercase tracking-[0.25em] text-violet-soft">Battle of the Playlists</div>
      <h2 className="text-4xl font-black leading-tight md:text-5xl">{pl.prompt}</h2>
      <div className="flex flex-col gap-4 md:flex-row">
        <SongCard side="A" name={pl.a.name} song={pl.a.song} votes={pl.votes?.a ?? null} winner={pl.winner === "A"} />
        <div className="self-center font-display text-4xl font-black text-muted">VS</div>
        <SongCard side="B" name={pl.b.name} song={pl.b.song} votes={pl.votes?.b ?? null} winner={pl.winner === "B"} />
      </div>
      <p className="text-xl text-muted">
        {v.phase === "PICKING"
          ? `${pl.a.name} and ${pl.b.name} are picking songs on their phones…`
          : v.phase === "VOTING"
            ? `Everyone else: vote on your phone (${v.answered} voted)`
            : pl.winner === "DRAW"
              ? "It's a draw!"
              : `${pl.winner === "A" ? pl.a.name : pl.b.name} takes it!`}
      </p>
    </section>
  );
}

function Podium({ v }: { v: PartyHostView }) {
  const top = v.standings.slice(0, 3);
  if (!top.length) return null;
  const medal = ["🥇", "🥈", "🥉"];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-3xl font-black">{v.phase === "FINAL" ? "Final standings" : "Standings"}</h2>
      <div className="flex flex-wrap items-end gap-3">
        {top.map((p, i) => (
          <div key={p.id} className="flex flex-1 flex-col items-center gap-1 rounded-2xl border border-line bg-surface-1 p-4" style={{ minHeight: `${180 - i * 30}px` }}>
            <div className="text-5xl">{medal[i]}</div>
            <div className="text-2xl font-black">{p.name}</div>
            <div className="font-mono text-xl">{p.score}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
