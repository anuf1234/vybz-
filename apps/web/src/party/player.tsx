"use client";

import { type CatalogHit, PARTY_GAMES, type PartyJoined, type PartyPlayerSelfView, normalizePartyCode, partyCodeLabel } from "@vybz/core";
import { useEffect, useRef, useState } from "react";
import { CHOICE_COLORS, CHOICE_SHAPES, partyCall, playerKeyName, readKey, useCountdown, usePoll, writeKey } from "./client";

/** /p: type a code. */
export function PartyCodeEntry() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    const c = normalizePartyCode(code);
    if (!c) return setError("Codes look like VYBZ-4821.");
    window.location.href = `/p/${c}${location.search}`;
  };
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-16" data-embed="app">
      <h1 className="font-display text-4xl font-black">Join a party</h1>
      <input
        value={code}
        onChange={(e) => setCode(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        inputMode="numeric"
        autoFocus
        placeholder="VYBZ-4821"
        aria-label="Party code"
        className="rounded-xl border border-line bg-surface-1 px-4 py-4 text-center font-mono text-3xl tracking-widest"
      />
      <button type="button" onClick={go} className="rounded-xl bg-violet py-4 text-xl font-black text-white">
        Join
      </button>
      {error ? <p className="text-[#FF6B8A]">{error}</p> : null}
    </div>
  );
}

/** A player's phone: join with a name, then answer, pick and vote. */
export function PartyPlayer({ code }: { code: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setKey(readKey(playerKeyName(code)));
    setReady(true);
  }, [code]);
  const poll = usePoll<PartyPlayerSelfView>(ready && key ? () => partyCall(`/api/v1/party/${code}/me`, key) : null, 1000);
  useEffect(() => {
    if (poll.error?.code === "NOT_IN_PARTY") {
      writeKey(playerKeyName(code), null);
      setKey(null);
    }
  }, [poll.error, code]);

  if (!ready) return null;
  if (!key) return <JoinForm code={code} onJoined={(k) => setKey(k)} />;
  const v = poll.data;
  if (!v) return <div className="py-20 text-center text-muted" data-embed="app">{poll.error ? poll.error.message : "Connecting…"}</div>;
  return <PlayerStage v={v} code={code} playerKey={key} onUpdate={poll.setData} />;
}

function JoinForm({ code, onJoined }: { code: string; onJoined: (k: string) => void }) {
  const [name, setName] = useState("");
  const [info, setInfo] = useState<{ title: string; players: number; open: boolean; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    partyCall<{ title: string; players: number; open: boolean; label: string }>(`/api/v1/party/${code}`, null).then(setInfo, (e) => setError((e as Error).message));
  }, [code]);
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await partyCall<PartyJoined>(`/api/v1/party/${code}/join`, null, { method: "POST", body: { name } });
      writeKey(playerKeyName(code), r.playerKey);
      onJoined(r.playerKey);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-12" data-embed="app">
      <div className="text-xs font-bold uppercase tracking-[0.3em] text-violet-soft">{partyCodeLabel(code)}</div>
      <h1 className="font-display text-4xl font-black">{info?.title ?? "Vybz Party"}</h1>
      {info ? <p className="text-muted">{info.players} here so far</p> : null}
      {info && !info.open ? (
        <p className="text-lg">This party is over or full.</p>
      ) : (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && void join()}
            maxLength={20}
            autoFocus
            placeholder="Your name"
            aria-label="Your name"
            className="rounded-xl border border-line bg-surface-1 px-4 py-4 text-2xl"
          />
          <button type="button" onClick={() => void join()} disabled={!name.trim() || busy} className="rounded-xl bg-violet py-4 text-xl font-black text-white disabled:opacity-50">
            {busy ? "Joining…" : "Join the party"}
          </button>
        </>
      )}
      {error ? <p className="text-[#FF6B8A]">{error}</p> : null}
      <p className="text-xs text-muted">Signed in to VYBZ? Join from the app to earn XP.</p>
    </div>
  );
}

function PlayerStage({ v, code, playerKey, onUpdate }: { v: PartyPlayerSelfView; code: string; playerKey: string; onUpdate: (v: PartyPlayerSelfView) => void }) {
  const left = useCountdown(v.deadline, v.serverNow);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      onUpdate(await partyCall<PartyPlayerSelfView>(`/api/v1/party/${code}/answer`, playerKey, { method: "POST", body }));
      if ("vibrate" in navigator) navigator.vibrate?.(30);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const live = !["LOBBY", "SCORES", "FINAL"].includes(v.phase);
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 py-4" data-embed="app">
      <header className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-black">{v.me.name}</div>
          <div className="text-xs text-muted">
            {v.me.score} pts · #{v.me.rank}
            {v.game && live ? ` · ${PARTY_GAMES[v.game].label} ${v.round}/${v.rounds}` : ""}
          </div>
        </div>
        {live && left !== null ? <div className="font-mono text-3xl font-black tabular-nums">{left}</div> : null}
      </header>
      {live && v.paused ? <p className="rounded-xl border border-violet-soft p-3 text-center font-bold text-violet-soft">❚❚ The host paused the game. Hang tight.</p> : null}

      {v.phase === "LOBBY" ? (
        <Waiting title="You're in! 🎉" body={`Watch the big screen. ${v.title} starts when the host picks a game.`} />
      ) : null}

      {v.question && (v.phase === "QUESTION" || v.phase === "REVEAL") ? (
        <section className="flex flex-col gap-3">
          <p className="text-lg font-bold leading-snug">{v.question.prompt}</p>
          {v.question.imageUrl ? <img src={v.question.imageUrl} alt="Album cover" className="mx-auto h-36 w-36 rounded-lg object-cover" /> : null}
          {/* Stream-safe parties play Name That Song on phones, not the big screen. */}
          {v.question.audioUrl && v.phase === "QUESTION" ? <audio key={`${v.round}`} src={v.question.audioUrl} autoPlay controls className="w-full" /> : null}
          <div className="grid grid-cols-1 gap-3">
            {v.question.choices.map((c, i) => {
              const mine = v.myAnswer?.choice === i;
              const right = v.reveal?.answerIndex === i;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={busy || v.phase !== "QUESTION" || !!v.myAnswer}
                  onClick={() => void send({ choice: i })}
                  className="min-h-16 rounded-2xl border-2 px-4 text-left text-xl font-black transition disabled:cursor-default"
                  style={{
                    borderColor: CHOICE_COLORS[i],
                    background: mine || right ? `${CHOICE_COLORS[i]}66` : `${CHOICE_COLORS[i]}1f`,
                    opacity: v.myAnswer && !mine && !right ? 0.4 : 1,
                  }}
                >
                  <span className="mr-2">{CHOICE_SHAPES[i]}</span>
                  {c}
                  {right ? " ✓" : ""}
                </button>
              );
            })}
          </div>
          {v.phase === "QUESTION" && v.myAnswer ? <p className="text-center text-lg font-bold">Locked in. Eyes on the big screen.</p> : null}
          {v.phase === "REVEAL" && v.myAnswer ? (
            <p className={`text-center text-2xl font-black ${v.myAnswer.correct ? "text-live" : "text-[#FF6B8A]"}`}>
              {v.myAnswer.correct ? `Correct! +${v.myAnswer.points}` : v.myAnswer.choice === null ? "Too slow!" : "Not this time"}
            </p>
          ) : null}
        </section>
      ) : null}

      {v.playlist ? <PlaylistTurn v={v} code={code} playerKey={playerKey} send={send} busy={busy} /> : null}

      {v.phase === "SCORES" || v.phase === "FINAL" ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xl font-black">{v.phase === "FINAL" ? "That's a wrap!" : "Scores"}</h2>
          <p className="text-lg">
            You finished <span className="font-black">#{v.me.rank}</span> with {v.me.score} points.
          </p>
          <ol className="flex flex-col gap-1">
            {v.standings.map((s, i) => (
              <li key={s.id} className={`flex justify-between rounded-lg px-3 py-2 ${s.id === v.me.id ? "bg-plum" : "bg-surface-1"}`}>
                <span>
                  {i + 1}. {s.name}
                </span>
                <span className="font-mono">{s.score}</span>
              </li>
            ))}
          </ol>
          {v.phase === "FINAL" ? (
            <a href="https://apps.apple.com/app/id6835731754" className="mt-3 rounded-xl border border-violet px-4 py-3 text-center font-bold">
              Get VYBZ: battle your music taste every day
            </a>
          ) : (
            <p className="text-muted">Waiting for the host to pick the next game…</p>
          )}
        </section>
      ) : null}
      {error ? <p className="text-center text-[#FF6B8A]">{error}</p> : null}
    </div>
  );
}

function Waiting({ title, body }: { title: string; body: string }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="text-3xl font-black">{title}</div>
      <p className="text-muted">{body}</p>
    </section>
  );
}

function PlaylistTurn({ v, code, playerKey, send, busy }: { v: PartyPlayerSelfView; code: string; playerKey: string; send: (b: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const pl = v.playlist!;
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (pl.role !== "PICKER" || v.phase !== "PICKING" || q.trim().length < 2) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      setSearching(true);
      partyCall<{ items: CatalogHit[] }>(`/api/v1/party/${code}/search?q=${encodeURIComponent(q.trim())}`, playerKey)
        .then((r) => n === seq.current && setHits(r.items))
        .catch(() => undefined)
        .finally(() => n === seq.current && setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [q, pl.role, v.phase, code, playerKey]);

  const mine = pl.mySide === "A" ? pl.a.song : pl.mySide === "B" ? pl.b.song : null;
  const other = pl.mySide === "A" ? pl.b.name : pl.a.name;
  return (
    <section className="flex flex-col gap-3">
      <div className="text-xs font-bold uppercase tracking-[0.25em] text-violet-soft">Battle of the Playlists</div>
      <h2 className="text-2xl font-black leading-tight">{pl.prompt}</h2>
      {v.phase === "PICKING" && pl.role === "PICKER" ? (
        <>
          <p className="text-muted">You vs {other}. Pick your song!</p>
          {mine ? (
            <div className="rounded-xl border border-live bg-live/10 p-3">
              Your pick: <span className="font-bold">{mine.title}</span> · {mine.artistName}
              <div className="text-xs text-muted">You can change it until time's up.</div>
            </div>
          ) : null}
          <input value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Search for a song" aria-label="Search for a song" className="rounded-xl border border-line bg-surface-1 px-4 py-3 text-lg" />
          {searching ? <p className="text-sm text-muted">Searching…</p> : null}
          <ul className="flex flex-col gap-2">
            {hits.map((h) => (
              <li key={h.catalogId}>
                <button type="button" disabled={busy} onClick={() => void send({ catalogId: h.catalogId })} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-1 p-2 text-left">
                  {h.artworkUrl ? <img src={h.artworkUrl} alt="" className="h-12 w-12 rounded object-cover" /> : <div className="h-12 w-12 rounded bg-surface-3" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{h.title}</span>
                    <span className="block truncate text-sm text-muted">
                      {h.artistName}
                      {h.releaseYear ? ` · ${h.releaseYear}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {v.phase === "PICKING" && pl.role === "VOTER" ? <Waiting title="Get ready to vote" body={`${pl.a.name} and ${pl.b.name} are picking songs…`} /> : null}
      {v.phase === "VOTING" ? (
        pl.role === "VOTER" ? (
          <div className="flex flex-col gap-3">
            {(["A", "B"] as const).map((s, i) => {
              const side = s === "A" ? pl.a : pl.b;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={busy || !!pl.myVote}
                  onClick={() => void send({ side: s })}
                  className="flex items-center gap-3 rounded-2xl border-2 p-3 text-left"
                  style={{ borderColor: CHOICE_COLORS[i], background: pl.myVote === s ? `${CHOICE_COLORS[i]}55` : `${CHOICE_COLORS[i]}1a`, opacity: pl.myVote && pl.myVote !== s ? 0.45 : 1 }}
                >
                  {side.song?.artworkUrl ? <img src={side.song.artworkUrl} alt="" className="h-16 w-16 rounded-lg object-cover" /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold uppercase text-muted">{side.name}</span>
                    <span className="block truncate text-lg font-black">{side.song?.title ?? "No pick"}</span>
                    <span className="block truncate text-sm text-muted">{side.song?.artistName}</span>
                  </span>
                </button>
              );
            })}
            {pl.myVote ? <p className="text-center font-bold">Vote in. Watch the big screen!</p> : null}
          </div>
        ) : (
          <Waiting title="The crowd is voting…" body="Fingers crossed." />
        )
      ) : null}
      {v.phase === "RESULT" ? (
        <Waiting
          title={pl.winner === "DRAW" ? "It's a draw!" : pl.mySide ? (pl.winner === pl.mySide ? "You won the battle! 🏆" : "So close!") : `${pl.winner === "A" ? pl.a.name : pl.b.name} wins!`}
          body={pl.votes ? `${pl.votes.a} – ${pl.votes.b}` : ""}
        />
      ) : null}
    </section>
  );
}
