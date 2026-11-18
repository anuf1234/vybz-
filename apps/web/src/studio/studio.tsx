"use client";

import { DJ_LIMITS, type DjBattleView, type DjEvent, type DjLesson, type DjSetStats, type DjSetView, type DjTrackRef, VYBZ_PACK, camelotCompatible, djLesson, tempoCompatible } from "@vybz/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Btn, CrowdMeter, Deck, MixerPanel } from "./controls";
import { type DeckId, formatTime } from "./engine";
import { SetPlayer } from "./player";
import { PracticeChecker, type Snapshot, StudioSession } from "./session";

export interface StudioProps {
  user: { handle: string } | null;
  lessonId: string | null;
  mode: "demo" | "practice" | null;
  setId: string | null;
  djBattleId: string | null;
  embed: boolean;
}

type Act = Parameters<StudioSession["apply"]>[0];

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(data.message ?? (res.status === 401 ? "Sign in through the VYBZ app to save." : `Something went wrong (${data.error ?? res.status}).`));
  return data;
}

/** Tells the VYBZ app (when the studio is open inside it) that something changed. */
function notifyApp(msg: Record<string, unknown>) {
  const w = window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } };
  w.ReactNativeWebView?.postMessage(JSON.stringify(msg));
  if (window.parent !== window) window.parent.postMessage(JSON.stringify(msg), "*");
}

export function Studio(props: StudioProps) {
  const [session, setSession] = useState<StudioSession | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lesson = props.lessonId ? (djLesson(props.lessonId) ?? null) : null;

  const enter = async () => {
    try {
      const s = new StudioSession();
      await s.mixer.resume();
      s.start();
      if (process.env.NODE_ENV !== "production") (window as unknown as { __studio?: StudioSession }).__studio = s;
      setSession(s);
    } catch {
      setError("Your browser couldn't start audio. Try another browser.");
    }
  };
  useEffect(() => () => session?.dispose(), [session]);
  useEffect(() => (session ? session.subscribe(setSnap) : undefined), [session]);

  if (!session || !snap) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-5 py-14 text-center" data-embed={props.embed ? "app" : undefined}>
        <div className="font-display text-4xl font-black tracking-wide">DJ VYBZ STUDIO</div>
        <p className="text-muted">
          {lesson ? `${lesson.icon} ${lesson.course}: ${props.mode === "demo" ? "watch the demo" : "practice"}` : "Two decks, a mixer and a crossfader. Learn to mix, record sets and battle other DJs."}
        </p>
        <Btn tone="primary" onClick={() => void enter()} className="px-8 text-base">
          {lesson && props.mode === "demo" ? "▶ Start the demo" : props.djBattleId ? "▶ Hear the battle" : props.setId ? "▶ Hear the set" : "Enter the studio"}
        </Btn>
        <p className="max-w-md text-xs text-muted">
          The studio plays the VYBZ pack (original tracks you're free to mix and battle with) and files from your own device that you have the rights to. Streaming-service songs can't be loaded here, and nothing from your device is uploaded.
        </p>
        {error ? <p className="text-sm text-[#FF6B8A]">{error}</p> : null}
      </div>
    );
  }
  return <StudioRoom {...props} session={session} snap={snap} lesson={lesson} />;
}

function StudioRoom({ session, snap, lesson, ...props }: StudioProps & { session: StudioSession; snap: Snapshot; lesson: DjLesson | null }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ events: DjEvent[]; tracks: DjTrackRef[]; durationMs: number; stats: DjSetStats } | null>(null);
  const [locked, setLocked] = useState(false);
  const demoMode = lesson && props.mode === "demo";
  const practice = lesson && props.mode === "practice" ? lesson.practice : null;
  const act = useCallback((e: Act) => session.apply(e), [session]);

  const load = useCallback(
    async (deck: DeckId, vybzId: string) => {
      setBusy(true);
      try {
        session.loadTrack(deck, await session.loadPack(vybzId));
      } catch {
        setNote("Couldn't load that track. Check your connection.");
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  // Lesson setup: put the right tracks on the decks.
  const setupDone = useRef(false);
  useEffect(() => {
    const setup = demoMode ? lesson.demo.setup : practice?.setup;
    if (!setup || setupDone.current) return;
    setupDone.current = true;
    void (async () => {
      setBusy(true);
      if (setup.A) session.loadTrack("A", await session.loadPack(setup.A));
      if (setup.B) session.loadTrack("B", await session.loadPack(setup.B));
      if (setup.bTempo) session.apply({ k: "tempo", d: "B", v: setup.bTempo }, { record: false });
      session.apply({ k: "xf", v: setup.playA ? -1 : 0 }, { record: false });
      if (setup.playA) session.apply({ k: "play", d: "A" }, { record: false });
      if (practice) {
        session.loads = [];
        session.resetStats();
        session.crowd = 50;
        session.practice = new PracticeChecker(practice.check);
      }
      setBusy(false);
    })();
  }, [demoMode, practice, lesson, session]);

  // Practice passed: record it (and tell the app).
  const reported = useRef(false);
  useEffect(() => {
    if (!practice || !snap.practice?.passed || reported.current) return;
    reported.current = true;
    if (props.user) void call(`/api/v1/dj/lessons/${lesson!.id}`, { method: "POST", body: { step: "practice", check: practice.check.type } }).catch(() => undefined);
    notifyApp({ type: "dj-lesson", lessonId: lesson!.id, step: "practice" });
  }, [practice, snap.practice?.passed, lesson, props.user]);

  const toggleRecord = () => {
    if (snap.recording) {
      const r = session.stopRecording();
      if (r.durationMs < 3000) {
        setNote("That was too short to save.");
        return;
      }
      setSaved(r);
    } else {
      setSaved(null);
      session.startRecording();
    }
  };

  return (
    <div className="flex flex-col gap-3 py-3" data-embed={props.embed ? "app" : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto font-display text-2xl font-black tracking-wide">DJ VYBZ STUDIO</h1>
        {!demoMode && !props.djBattleId && !props.setId ? (
          <Btn tone="danger" on={snap.recording} onClick={toggleRecord} label={snap.recording ? "Stop recording" : "Record a set"}>
            {snap.recording ? `■ ${formatTime(snap.recordMs / 1000)}` : "● REC"}
          </Btn>
        ) : null}
      </div>
      {!props.djBattleId && !props.setId ? <CrowdMeter value={snap.crowd} /> : null}

      {demoMode ? <DemoPanel lesson={lesson} session={session} user={props.user} onLock={setLocked} /> : null}
      {practice ? <PracticePanel lesson={lesson!} snap={snap} /> : null}
      {props.setId ? <SetPanel id={props.setId} session={session} onLock={setLocked} /> : null}
      {props.djBattleId ? <BattlePanel id={props.djBattleId} session={session} user={props.user} onLock={setLocked} /> : null}
      {saved ? <SavePanel rec={saved} user={props.user} onDone={() => setSaved(null)} defaultBattle={practice?.check.type === "battleSet"} /> : null}
      {note ? (
        <p className="rounded-lg border border-line bg-surface-2 p-2 text-sm" role="status">
          {note}{" "}
          <button type="button" className="underline" onClick={() => setNote(null)}>
            OK
          </button>
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_minmax(300px,0.9fr)_1fr]">
        <Deck s={snap.A} session={session} act={act} noSync={practice?.noSync} onTap={() => session.tap("A")} locked={locked} />
        <MixerPanel snap={snap} act={act} locked={locked} />
        <Deck s={snap.B} session={session} act={act} noSync={practice?.noSync} onTap={() => session.tap("B")} locked={locked} />
      </div>

      {!locked ? <Library session={session} snap={snap} onLoad={load} busy={busy} onNote={setNote} /> : null}
      {props.user && !demoMode && !props.djBattleId && !props.setId ? <YourSets /> : null}
      {!props.user ? <p className="text-center text-xs text-muted">Open the studio from the VYBZ app to save sets, earn XP and battle.</p> : null}
    </div>
  );
}

// ── Library ────────────────────────────────────────────────────────────────

function Library({ session, snap, onLoad, busy, onNote }: { session: StudioSession; snap: Snapshot; onLoad: (d: DeckId, id: string) => Promise<void>; busy: boolean; onNote: (s: string) => void }) {
  const [rights, setRights] = useState(false);
  const [locals, setLocals] = useState<{ key: string; title: string; artist: string; bpm: number }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const a = snap.A;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of [...files].slice(0, 10)) {
      if (f.size > 60 * 1024 * 1024) {
        onNote(`${f.name} is over 60 MB.`);
        continue;
      }
      try {
        const t = await session.addLocalFile(f);
        setLocals((l) => (l.some((x) => x.key === t.meta.key) ? l : [...l, { key: t.meta.key, title: t.meta.title, artist: t.meta.artist, bpm: t.meta.bpm }]));
      } catch {
        onNote(`Couldn't read ${f.name}. Use an MP3, M4A, WAV or other audio file without copy protection.`);
      }
    }
  };

  const loadLocal = async (deck: DeckId, key: string) => {
    const p = session.localTrack(key.replace("local:", ""));
    if (p) session.loadTrack(deck, await p);
  };

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-1 p-3" aria-label="Library">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">VYBZ pack · free to mix, record and battle</h2>
        {busy ? <span className="text-xs text-muted">Loading…</span> : null}
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {VYBZ_PACK.map((t) => {
          const fits = a.nativeBpm && a.camelot && a.title !== t.title ? tempoCompatible(t.bpm, a.bpm ?? a.nativeBpm, 0.08) && camelotCompatible(a.camelot, t.camelot) : false;
          return (
            <li key={t.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">
                  {t.title} {fits ? <span className="ml-1 rounded bg-live/15 px-1.5 text-[10px] text-live">fits deck A</span> : null}
                </div>
                <div className="text-xs text-muted">
                  {t.genre} · {t.bpm} BPM · {t.key} {t.camelot} · energy {t.energy}
                </div>
              </div>
              <Btn onClick={() => void onLoad("A", t.id)} label={`Load ${t.title} on deck A`}>
                A
              </Btn>
              <Btn onClick={() => void onLoad("B", t.id)} label={`Load ${t.title} on deck B`}>
                B
              </Btn>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">Your own files</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.currentTarget.checked)} className="mt-1" />
          <span>I own these audio files or have permission to mix them. They stay on this device and are never uploaded.</span>
        </label>
        <input ref={fileRef} type="file" accept="audio/*" multiple className="hidden" onChange={(e) => void addFiles(e.currentTarget.files)} />
        <Btn disabled={!rights} onClick={() => fileRef.current?.click()}>
          Add audio files
        </Btn>
        <p className="text-xs text-muted">Sets that use your own files are saved for you only and can't be entered into DJ battles. Songs from Apple Music, YouTube and other streaming services can't be loaded.</p>
        {locals.map((t) => (
          <div key={t.key} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{t.title}</div>
              <div className="text-xs text-muted">
                {t.artist} · about {t.bpm} BPM (detected)
              </div>
            </div>
            <Btn onClick={() => void loadLocal("A", t.key)}>A</Btn>
            <Btn onClick={() => void loadLocal("B", t.key)}>B</Btn>
          </div>
        ))}
        {(["A", "B"] as const).map((id) =>
          snap[id].source === "LOCAL" ? (
            <label key={id} className="flex items-center gap-2 text-xs text-muted">
              Deck {id} tempo reading
              <input
                type="number"
                min={40}
                max={250}
                step={0.1}
                defaultValue={snap[id].nativeBpm ?? 120}
                onBlur={(e) => session.setNativeBpm(id, Number(e.currentTarget.value))}
                className="w-20 rounded border border-line bg-ink px-2 py-1 text-text"
                aria-label={`Correct deck ${id}'s BPM`}
              />
              BPM
            </label>
          ) : null,
        )}
      </div>
    </section>
  );
}

// ── Saving and your sets ───────────────────────────────────────────────────

function SavePanel({ rec, user, onDone, defaultBattle }: { rec: { events: DjEvent[]; tracks: DjTrackRef[]; durationMs: number; stats: DjSetStats }; user: StudioProps["user"]; onDone: () => void; defaultBattle?: boolean }) {
  const vybzOnly = rec.tracks.every((t) => t.source === "VYBZ");
  const battleOk = vybzOnly && rec.durationMs >= DJ_LIMITS.battleMinMs && rec.durationMs <= DJ_LIMITS.battleMaxMs;
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"SET" | "BATTLE">(defaultBattle && battleOk ? "BATTLE" : "SET");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const s = rec.stats;
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const set = await call<DjSetView>("/api/v1/dj/sets", { method: "POST", body: { title: title || `Mix ${new Date().toLocaleDateString()}`, kind, ...rec } });
      setMsg(`Saved "${set.title}".`);
      notifyApp({ type: "dj-set-saved", id: set.id });
      setTimeout(onDone, 1200);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-violet bg-plum/50 p-3" aria-label="Save your recording">
      <h2 className="font-bold">Your recording: {formatTime(rec.durationMs / 1000)}</h2>
      <p className="text-sm text-muted">
        {rec.tracks.length} track{rec.tracks.length === 1 ? "" : "s"} · {s.transitions} transition{s.transitions === 1 ? "" : "s"}
        {s.beatmatchPct !== null ? ` · ${s.beatmatchPct}% beatmatched` : ""}
        {s.longestSilenceMs > 1000 ? ` · ${(s.longestSilenceMs / 1000).toFixed(1)}s silence` : ""}
      </p>
      {user ? (
        <>
          <input value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={DJ_LIMITS.titleMax} placeholder="Name your set" className="rounded-lg border border-line bg-ink px-3 py-2" aria-label="Set name" />
          <div className="flex gap-2" role="radiogroup" aria-label="Save as">
            <Btn on={kind === "SET"} onClick={() => setKind("SET")} role="radio" aria-checked={kind === "SET"}>
              DJ set
            </Btn>
            <Btn on={kind === "BATTLE"} disabled={!battleOk} onClick={() => setKind("BATTLE")} role="radio" aria-checked={kind === "BATTLE"}>
              Battle set
            </Btn>
          </div>
          {!battleOk ? <p className="text-xs text-muted">Battle sets run 30 seconds to 3 minutes and use VYBZ pack tracks only.</p> : null}
          <div className="flex gap-2">
            <Btn tone="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Btn>
            <Btn onClick={onDone}>Discard</Btn>
          </div>
        </>
      ) : (
        <p className="text-sm">Open the studio from the VYBZ app to save sets.</p>
      )}
      {msg ? (
        <p className="text-sm" role="status">
          {msg}
        </p>
      ) : null}
    </section>
  );
}

function YourSets() {
  const [sets, setSets] = useState<DjSetView[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const reload = useCallback(() => void call<{ items: DjSetView[] }>("/api/v1/dj/sets").then((r) => setSets(r.items), () => setSets([])), []);
  useEffect(reload, [reload]);
  if (!sets?.length) return null;
  const startBattle = async (s: DjSetView) => {
    try {
      const b = await call<DjBattleView>("/api/v1/dj/battles", { method: "POST", body: { setId: s.id } });
      window.location.href = `/studio?djbattle=${b.id}${location.search.includes("embed=app") ? "&embed=app" : ""}`;
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-1 p-3" aria-label="Your sets">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">Your sets</h2>
      {sets.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">
              {s.title} {s.kind === "BATTLE" ? <span className="ml-1 rounded bg-plum px-1.5 text-[10px] text-violet-soft">battle set</span> : null}
            </div>
            <div className="text-xs text-muted">
              {formatTime(s.durationMs / 1000)} · {s.stats.transitions} transitions{s.stats.beatmatchPct !== null ? ` · ${s.stats.beatmatchPct}% beatmatched` : ""}
            </div>
          </div>
          <a className="min-h-11 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm font-bold" href={`/studio?set=${s.id}${location.search.includes("embed=app") ? "&embed=app" : ""}`}>
            ▶ Play
          </a>
          {s.kind === "BATTLE" ? <Btn onClick={() => void startBattle(s)}>Start a DJ battle</Btn> : null}
        </div>
      ))}
      {msg ? <p className="text-sm">{msg}</p> : null}
    </section>
  );
}

// ── Set playback ───────────────────────────────────────────────────────────

function useSetPlayer(session: StudioSession, set: (DjSetView & { events: DjEvent[] }) | null, onLock: (b: boolean) => void) {
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const player = useMemo(() => (set ? new SetPlayer(session, set) : null), [session, set]);
  useEffect(() => {
    if (!player) return;
    player.onProgress = setMs;
    player.onDone = () => {
      setPlaying(false);
      onLock(false);
    };
    return () => player.stop();
  }, [player, onLock]);
  const play = async () => {
    if (!player) return;
    setErr(null);
    try {
      await player.prepare();
      onLock(true);
      setPlaying(true);
      player.play();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const stop = () => {
    player?.stop();
    setPlaying(false);
    onLock(false);
  };
  return { ms, playing, err, play, stop, player };
}

function SetPanel({ id, session, onLock }: { id: string; session: StudioSession; onLock: (b: boolean) => void }) {
  const [set, setSet] = useState<(DjSetView & { events: DjEvent[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    call<DjSetView>(`/api/v1/dj/sets/${id}`).then((s) => setSet(s as DjSetView & { events: DjEvent[] }), (e) => setErr((e as Error).message));
  }, [id]);
  const p = useSetPlayer(session, set, onLock);
  if (err) return <p className="text-sm text-[#FF6B8A]">{err}</p>;
  if (!set) return <p className="text-sm text-muted">Loading the set…</p>;
  const missing = p.player?.missing() ?? [];
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-violet bg-plum/40 p-3" aria-label="Set playback">
      <h2 className="font-bold">
        {set.title} <span className="text-sm font-normal text-muted">by @{set.owner.handle}</span>
      </h2>
      <Progress ms={p.ms} total={set.durationMs} />
      {missing.length ? <p className="text-xs text-muted">Add these files from your device to hear this set: {missing.map((m) => m.title).join(", ")}</p> : null}
      <div className="flex gap-2">
        {p.playing ? <Btn onClick={p.stop}>■ Stop</Btn> : <Btn tone="primary" onClick={() => void p.play()}>▶ Play set</Btn>}
      </div>
      {p.err ? <p className="text-sm text-[#FF6B8A]">{p.err}</p> : null}
    </section>
  );
}

function Progress({ ms, total }: { ms: number; total: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <div className="h-2 flex-1 overflow-hidden rounded bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(ms)} aria-label="Playback">
        <div className="h-full bg-violet" style={{ width: `${Math.min(100, (100 * ms) / Math.max(1, total))}%` }} />
      </div>
      <span className="font-mono tabular-nums">
        {formatTime(ms / 1000)} / {formatTime(total / 1000)}
      </span>
    </div>
  );
}

// ── DJ University ──────────────────────────────────────────────────────────

function DemoPanel({ lesson, session, user, onLock }: { lesson: DjLesson; session: StudioSession; user: StudioProps["user"]; onLock: (b: boolean) => void }) {
  const [caption, setCaption] = useState("Getting the decks ready…");
  const [done, setDone] = useState(false);
  const [running, setRunning] = useState(false);
  const run = useCallback(async () => {
    setRunning(true);
    setDone(false);
    onLock(true);
    const steps = lesson.demo.steps;
    const t0 = performance.now();
    for (const step of steps) {
      const wait = step.at - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setCaption(step.caption);
      for (const mv of step.moves ?? []) {
        if (mv.k === "load" && mv.d && typeof mv.v === "number") {
          const t = VYBZ_PACK[mv.v];
          if (t) session.loadTrack(mv.d, await session.loadPack(t.id));
        } else {
          session.apply(mv, { record: false });
        }
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
    setRunning(false);
    setDone(true);
    onLock(false);
    if (user) void call(`/api/v1/dj/lessons/${lesson.id}`, { method: "POST", body: { step: "demo" } }).catch(() => undefined);
    notifyApp({ type: "dj-lesson", lessonId: lesson.id, step: "demo" });
  }, [lesson, session, user, onLock]);

  useEffect(() => {
    // Give the setup a moment to load the tracks.
    const t = setTimeout(() => void run(), 1500);
    return () => clearTimeout(t);
    // Once, when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-violet bg-plum/50 p-4" aria-label="Demo">
      <div className="text-[11px] font-bold uppercase tracking-wider text-violet-soft">
        {lesson.icon} {lesson.course} · demo
      </div>
      <p className="text-lg font-bold" aria-live="polite">
        {caption}
      </p>
      {done ? (
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => void run()}>↺ Watch again</Btn>
          <a className="min-h-11 rounded-lg border border-violet bg-violet px-3 py-2.5 text-sm font-bold text-white" href={`/studio?lesson=${lesson.id}&mode=practice${location.search.includes("embed=app") ? "&embed=app" : ""}`}>
            Try it yourself →
          </a>
        </div>
      ) : running ? (
        <p className="text-xs text-muted">The studio is driving. Controls unlock when the demo ends.</p>
      ) : null}
    </section>
  );
}

function PracticePanel({ lesson, snap }: { lesson: DjLesson; snap: Snapshot }) {
  const p = lesson.practice;
  const passed = snap.practice?.passed;
  return (
    <section className={`flex flex-col gap-2 rounded-2xl border p-4 ${passed ? "border-live bg-live/10" : "border-violet bg-plum/50"}`} aria-label="Practice">
      <div className="text-[11px] font-bold uppercase tracking-wider text-violet-soft">
        {lesson.icon} {lesson.course} · practice
      </div>
      <p className="text-lg font-bold">{p.goal}</p>
      <ol className="list-decimal pl-5 text-sm text-muted">
        {p.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className={`font-bold ${passed ? "text-live" : "text-text"}`} role="status" aria-live="polite">
        {passed ? "✓ " : ""}
        {snap.practice?.detail}
      </p>
      {passed ? <p className="text-sm">Practice done. Go back to the lesson for the quiz and your XP.</p> : null}
    </section>
  );
}

// ── DJ battles ─────────────────────────────────────────────────────────────

function BattlePanel({ id, session, user, onLock }: { id: string; session: StudioSession; user: StudioProps["user"]; onLock: (b: boolean) => void }) {
  const [b, setB] = useState<DjBattleView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [heard, setHeard] = useState({ A: 0, B: 0 });
  const [mine, setMine] = useState<DjSetView[] | null>(null);
  const reload = useCallback(() => call<DjBattleView>(`/api/v1/dj/battles/${id}`).then(setB, (e) => setErr((e as Error).message)), [id]);
  useEffect(() => void reload(), [reload]);
  useEffect(() => {
    if (b?.canJoin && user) void call<{ items: DjSetView[] }>("/api/v1/dj/sets").then((r) => setMine(r.items.filter((s) => s.kind === "BATTLE")));
  }, [b?.canJoin, user]);
  const withEvents = (x: DjSetView | undefined) => (x?.events ? (x as DjSetView & { events: DjEvent[] }) : null);
  const setA = useMemo(() => withEvents(b?.a.set), [b?.a.set]);
  const setB_ = useMemo(() => withEvents(b?.b?.set), [b?.b?.set]);
  const pA = useSetPlayer(session, setA, onLock);
  const pB = useSetPlayer(session, setB_, onLock);
  useEffect(() => setHeard((h) => ({ ...h, A: Math.max(h.A, pA.ms) })), [pA.ms]);
  useEffect(() => setHeard((h) => ({ ...h, B: Math.max(h.B, pB.ms) })), [pB.ms]);
  const playing = pA.playing ? pA : pB.playing ? pB : null;

  if (err) return <p className="text-sm text-[#FF6B8A]">{err}</p>;
  if (!b) return <p className="text-sm text-muted">Loading the battle…</p>;
  const need = (s: "A" | "B") => ((s === "A" ? b.a.set.durationMs : (b.b?.set.durationMs ?? 0)) * 0.8);
  const ready = heard.A >= need("A") && heard.B >= need("B");
  const vote = async (s: "A" | "B") => {
    try {
      setB(await call<DjBattleView>(`/api/v1/dj/battles/${id}/vote`, { method: "POST", body: { side: s, listenedMs: heard } }));
      notifyApp({ type: "dj-battle-vote", id });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const join = async (setId: string) => {
    try {
      setB(await call<DjBattleView>(`/api/v1/dj/battles/${id}/join`, { method: "POST", body: { setId } }));
      notifyApp({ type: "dj-battle-joined", id });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const Side = ({ s }: { s: "A" | "B" }) => {
    const x = s === "A" ? b.a : b.b;
    if (!x) return <div className="flex-1 rounded-xl border border-dashed border-line p-3 text-sm text-muted">Waiting for a challenger</div>;
    const win = b.winner === s;
    return (
      <div className={`flex-1 rounded-xl border p-3 ${win ? "border-live" : (s === "A" ? pA : pB).playing ? "border-violet" : "border-line"} bg-surface-2`}>
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Set {s}</div>
        <div className="font-bold">@{x.dj.handle}</div>
        <div className="text-xs text-muted">
          {formatTime(x.set.durationMs / 1000)} · {x.set.stats.transitions} transitions{x.set.stats.beatmatchPct !== null ? ` · ${x.set.stats.beatmatchPct}% matched` : ""}
        </div>
        {x.votes !== null ? <div className="mt-1 text-xl font-black">{x.votes} votes {win ? "🏆" : ""}</div> : null}
        {b.status !== "OPEN" ? (
          <div className="mt-2 flex flex-col gap-1">
            <div className="h-1.5 overflow-hidden rounded bg-surface-3" aria-label={`Heard ${Math.round((100 * heard[s]) / Math.max(1, x.set.durationMs))}% of set ${s}`}>
              <div className="h-full bg-violet" style={{ width: `${Math.min(100, (100 * heard[s]) / Math.max(1, x.set.durationMs))}%` }} />
            </div>
            <Btn
              onClick={() => {
                (s === "A" ? pB : pA).stop();
                void (s === "A" ? pA : pB).play();
              }}
            >
              ▶ Play set {s}
            </Btn>
          </div>
        ) : null}
      </div>
    );
  };
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-violet bg-plum/40 p-4" aria-label="DJ battle">
      <div className="text-[11px] font-bold uppercase tracking-wider text-violet-soft">DJ battle · {b.status === "VOTING" ? "voting open" : b.status.toLowerCase()}</div>
      <h2 className="text-xl font-black">{b.title}</h2>
      <div className="flex gap-3">
        <Side s="A" />
        <Side s="B" />
      </div>
      {playing ? (
        <>
          <Progress ms={playing.ms} total={(playing === pA ? setA : setB_)?.durationMs ?? 0} />
          <Btn onClick={playing.stop}>■ Stop</Btn>
        </>
      ) : null}
      {pA.err || pB.err ? <p className="text-sm text-[#FF6B8A]">{pA.err ?? pB.err}</p> : null}
      {b.canVote ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{ready ? "You've heard both. Who won?" : "Listen to most of both sets, then vote."}</p>
          <div className="flex gap-2">
            <Btn tone="primary" on={b.myVote === "A"} disabled={!ready} onClick={() => void vote("A")} className="flex-1">
              Vote A {b.myVote === "A" ? "✓" : ""}
            </Btn>
            <Btn tone="primary" on={b.myVote === "B"} disabled={!ready} onClick={() => void vote("B")} className="flex-1">
              Vote B {b.myVote === "B" ? "✓" : ""}
            </Btn>
          </div>
        </div>
      ) : null}
      {b.status === "VOTING" && b.votingEndsAt ? <p className="text-xs text-muted">Voting closes {new Date(b.votingEndsAt).toLocaleString()}. Counts show when it ends.</p> : null}
      {b.status === "COMPLETE" ? <p className="font-bold">{b.winner === "DRAW" ? "It's a draw." : `@${(b.winner === "A" ? b.a : b.b!).dj.handle} wins.`}</p> : null}
      {b.canJoin ? (
        user ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">Take this battle with one of your battle sets:</p>
            {mine?.length ? (
              mine.map((s) => (
                <Btn key={s.id} onClick={() => void join(s.id)}>
                  Enter "{s.title}" ({formatTime(s.durationMs / 1000)})
                </Btn>
              ))
            ) : (
              <p className="text-xs text-muted">Record a 30s–3min set with VYBZ pack tracks and save it as a battle set first.</p>
            )}
          </div>
        ) : (
          <p className="text-sm">Open this from the VYBZ app to take the battle.</p>
        )
      ) : null}
    </section>
  );
}
