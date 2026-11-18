"use client";

import { useEffect, useRef } from "react";
import { type Band, type DeckId, EQ_MAX, EQ_MIN, formatTime } from "./engine";
import type { DeckSnapshot, Snapshot, StudioSession } from "./session";

const DECK_COLOR: Record<DeckId, string> = { A: "#8B5CF6", B: "#F5A524" };

/** Overview (whole track) and a zoomed, scrolling view with the beat grid. Drawn every frame from the engine. */
export function Waveform({ session, id, onSeek }: { session: StudioSession; id: DeckId; onSeek: (sec: number) => void }) {
  const overview = useRef<HTMLCanvasElement>(null);
  const zoom = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const d = session.mixer.deck(id);
      const t = d.track;
      for (const c of [overview.current, zoom.current]) {
        if (!c) continue;
        const w = c.clientWidth * devicePixelRatio;
        const h = c.clientHeight * devicePixelRatio;
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
      }
      const ov = overview.current?.getContext("2d");
      const zm = zoom.current?.getContext("2d");
      if (!ov || !zm || !overview.current || !zoom.current) return;
      const W = overview.current.width;
      const H = overview.current.height;
      ov.clearRect(0, 0, W, H);
      const ZW = zoom.current.width;
      const ZH = zoom.current.height;
      zm.clearRect(0, 0, ZW, ZH);
      if (!t) return;
      const peaks = t.peaks;
      const n = peaks.length / 2;
      const pos = d.position();
      const dur = d.duration || 1;
      // Overview
      ov.fillStyle = "#33224F";
      for (let x = 0; x < W; x++) {
        const i = Math.floor((x / W) * n);
        const lo = peaks[i * 2]!;
        const hi = peaks[i * 2 + 1]!;
        const played = x / W <= pos / dur;
        ov.fillStyle = played ? DECK_COLOR[id] : "#5B4A7A";
        ov.fillRect(x, H / 2 - hi * H * 0.48, 1, Math.max(1, (hi - lo) * H * 0.48));
      }
      ov.fillStyle = "#F4F0FB";
      ov.fillRect((pos / dur) * W - 1, 0, 2 * devicePixelRatio, H);
      ov.fillStyle = "#39FF88";
      ov.fillRect((d.cue / dur) * W - 1, 0, 2 * devicePixelRatio, H * 0.25);
      // Zoom: 8 seconds around the playhead, beat grid behind.
      const span = 8;
      const start = pos - span / 2;
      const bl = d.beatLength();
      const fb = t.meta.firstBeat;
      for (let k = Math.ceil((start - fb) / bl); fb + k * bl < start + span; k++) {
        const x = ((fb + k * bl - start) / span) * ZW;
        zm.fillStyle = k % 4 === 0 ? "rgba(196,181,253,0.55)" : "rgba(196,181,253,0.18)";
        zm.fillRect(x, 0, k % 4 === 0 ? 2 : 1, ZH);
      }
      zm.fillStyle = DECK_COLOR[id];
      for (let x = 0; x < ZW; x += 2) {
        const sec = start + (x / ZW) * span;
        if (sec < 0 || sec > dur) continue;
        const i = Math.floor((sec / dur) * n);
        const lo = peaks[i * 2] ?? 0;
        const hi = peaks[i * 2 + 1] ?? 0;
        zm.globalAlpha = sec <= pos ? 0.55 : 1;
        zm.fillRect(x, ZH / 2 - hi * ZH * 0.48, 2, Math.max(1, (hi - lo) * ZH * 0.48));
      }
      zm.globalAlpha = 1;
      zm.fillStyle = "#F4F0FB";
      zm.fillRect(ZW / 2 - 1, 0, 2 * devicePixelRatio, ZH);
      if (d.cue >= start && d.cue <= start + span) {
        zm.fillStyle = "#39FF88";
        zm.fillRect(((d.cue - start) / span) * ZW - 1, 0, 3, ZH);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [session, id]);

  const seekFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * session.mixer.deck(id).duration);
  };

  return (
    <div className="flex flex-col gap-1">
      <canvas ref={zoom} className="h-20 w-full rounded-md bg-ink" aria-hidden />
      <canvas ref={overview} className="h-8 w-full cursor-pointer rounded-md bg-ink" onPointerDown={seekFrom} role="img" aria-label={`Deck ${id} waveform. Click to jump.`} />
    </div>
  );
}

export function Btn({
  children,
  onClick,
  on,
  tone = "default",
  label,
  disabled,
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  onClick?: () => void;
  on?: boolean;
  tone?: "default" | "primary" | "live" | "danger";
  label?: string;
  disabled?: boolean;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children">) {
  const tones = {
    default: on ? "border-violet bg-plum text-text" : "border-line bg-surface-2 text-text hover:bg-surface-3",
    primary: "border-violet bg-violet text-white hover:brightness-110",
    live: on ? "border-live bg-live/15 text-live" : "border-line bg-surface-2 text-text hover:bg-surface-3",
    danger: on ? "border-[#FF6B8A] bg-[#FF6B8A]/20 text-[#FF6B8A]" : "border-line bg-surface-2 text-text hover:bg-surface-3",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      className={`min-h-11 rounded-lg border px-3 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-soft disabled:opacity-40 ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  valueText,
  vertical,
  className = "",
  accent,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  valueText: string;
  vertical?: boolean;
  className?: string;
  accent?: string;
}) {
  return (
    <label className={`flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted ${vertical ? "flex-col" : ""} ${className}`}>
      <span>{label.split(" ").slice(-1)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        onDoubleClick={() => onChange(min < 0 && max > 0 ? 0 : max)}
        aria-label={label}
        aria-valuetext={valueText}
        className={vertical ? "h-24 w-6 [writing-mode:vertical-lr] [direction:rtl]" : "w-full"}
        style={{ accentColor: accent ?? "#8B5CF6" }}
      />
      <span className="font-mono text-[10px] normal-case tracking-normal text-text">{valueText}</span>
    </label>
  );
}

export function Deck({
  s,
  session,
  act,
  noSync,
  onTap,
  locked,
}: {
  s: DeckSnapshot;
  session: StudioSession;
  act: (e: Parameters<StudioSession["apply"]>[0]) => void;
  noSync?: boolean;
  onTap: () => void;
  locked?: boolean;
}) {
  const id = s.id;
  const left = s.duration - s.position;
  const pct = ((s.rate - 1) * 100).toFixed(1);
  const loaded = !!s.title;
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-1 p-3" aria-label={`Deck ${id}`}>
      <div className="flex items-start gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-black text-ink" style={{ background: DECK_COLOR[id] }}>
          {id}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{s.title ?? "Empty deck"}</div>
          <div className="truncate text-xs text-muted">
            {s.artist ?? "Load a track from the library"}
            {s.camelot ? ` · ${s.key ?? ""} ${s.camelot}` : ""}
            {s.energy ? ` · energy ${s.energy}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-black tabular-nums" aria-label={`Tempo ${s.bpm?.toFixed(1) ?? "none"} BPM`}>
            {s.bpm ? s.bpm.toFixed(1) : "--.-"}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">BPM {Number(pct) !== 0 ? `(${Number(pct) > 0 ? "+" : ""}${pct}%)` : ""}</div>
        </div>
      </div>
      <Waveform session={session} id={id} onSeek={(sec) => !locked && act({ k: "seek", d: id, v: sec * 1000 })} />
      <div className="flex items-center justify-between font-mono text-xs tabular-nums text-muted" aria-live="off">
        <span aria-label="Elapsed">{formatTime(s.position)}</span>
        <span className={left < 15 && s.playing ? "text-[#FF6B8A]" : ""} aria-label="Remaining">
          -{formatTime(left)}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Btn tone="live" on={s.playing} disabled={!loaded || locked} onClick={() => act({ k: s.playing ? "pause" : "play", d: id })} label={`${s.playing ? "Pause" : "Play"} deck ${id}`}>
          {s.playing ? "❚❚" : "▶"}
        </Btn>
        <Btn disabled={!loaded || locked} onClick={() => act({ k: "cue", d: id })} label={`Cue deck ${id}: jump to the cue point and play`}>
          CUE
        </Btn>
        <Btn disabled={!loaded || locked} onClick={() => act({ k: "setcue", d: id })} label={`Set cue on deck ${id} at the nearest beat`}>
          SET
        </Btn>
        {noSync ? (
          <Btn disabled={!loaded || locked} onClick={onTap} label={`Tap tempo for deck ${id}`}>
            TAP
          </Btn>
        ) : (
          <Btn disabled={!loaded || locked} onClick={() => session.sync(id)} label={`Sync deck ${id} to the other deck`}>
            SYNC
          </Btn>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!loaded || locked}
          className="min-h-11 min-w-11 rounded-lg border border-line bg-surface-2 font-bold disabled:opacity-40"
          aria-label={`Nudge deck ${id} back (hold)`}
          onPointerDown={() => session.bend(id, -1)}
          onPointerUp={() => session.bend(id, 0)}
          onPointerLeave={() => s.playing && session.bend(id, 0)}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && session.bend(id, -1)}
          onKeyUp={() => session.bend(id, 0)}
        >
          ◀
        </button>
        <Slider
          label={`Deck ${id} tempo`}
          value={s.rate}
          min={0.84}
          max={1.16}
          step={0.0005}
          onChange={(v) => act({ k: "tempo", d: id, v })}
          valueText={`${Number(pct) > 0 ? "+" : ""}${pct}%`}
          className="flex-1"
          accent={DECK_COLOR[id]}
        />
        <button
          type="button"
          disabled={!loaded || locked}
          className="min-h-11 min-w-11 rounded-lg border border-line bg-surface-2 font-bold disabled:opacity-40"
          aria-label={`Nudge deck ${id} forward (hold)`}
          onPointerDown={() => session.bend(id, 1)}
          onPointerUp={() => session.bend(id, 0)}
          onPointerLeave={() => s.playing && session.bend(id, 0)}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && session.bend(id, 1)}
          onKeyUp={() => session.bend(id, 0)}
        >
          ▶
        </button>
      </div>
      {noSync || s.tapBpm ? (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Tapped: {s.tapBpm ? `${s.tapBpm} BPM` : "—"}</span>
          {!noSync ? (
            <button type="button" className="underline" onClick={onTap}>
              Tap again
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const BANDS: Band[] = ["high", "mid", "low"];

export function MixerPanel({ snap, act, locked }: { snap: Snapshot; act: (e: Parameters<StudioSession["apply"]>[0]) => void; locked?: boolean }) {
  const ph = snap.phaseMs;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-1 p-3" aria-label="Mixer">
      <div className="grid grid-cols-2 gap-3">
        {(["A", "B"] as const).map((id) => {
          const d = snap[id];
          return (
            <div key={id} className="flex flex-col gap-2" aria-label={`Deck ${id} channel`}>
              <div className="flex items-end justify-around">
                {BANDS.map((b) => (
                  <div key={b} className="flex flex-col items-center gap-1">
                    <Slider
                      vertical
                      label={`Deck ${id} ${b}`}
                      value={d.eq[b]}
                      min={EQ_MIN}
                      max={EQ_MAX}
                      step={0.5}
                      onChange={(v) => !locked && act({ k: "eq", d: id, b, v })}
                      valueText={d.eq[b] <= EQ_MIN ? "kill" : `${d.eq[b] > 0 ? "+" : ""}${d.eq[b].toFixed(0)} dB`}
                      accent={DECK_COLOR[id]}
                    />
                    <button
                      type="button"
                      aria-pressed={d.eq[b] <= EQ_MIN}
                      aria-label={`${d.eq[b] <= EQ_MIN ? "Restore" : "Kill"} deck ${id} ${b}`}
                      disabled={locked}
                      onClick={() => act({ k: "eq", d: id, b, v: d.eq[b] <= EQ_MIN ? 0 : EQ_MIN })}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${d.eq[b] <= EQ_MIN ? "bg-[#FF6B8A]/20 text-[#FF6B8A]" : "bg-surface-3 text-muted"}`}
                    >
                      KILL
                    </button>
                  </div>
                ))}
                <div className="flex flex-col items-center gap-1">
                  <Slider vertical label={`Deck ${id} volume`} value={d.volume} min={0} max={1} step={0.01} onChange={(v) => !locked && act({ k: "vol", d: id, v })} valueText={`${Math.round(d.volume * 100)}%`} accent={DECK_COLOR[id]} />
                  <div className="h-1.5 w-8 overflow-hidden rounded bg-surface-3" aria-hidden>
                    <div className="h-full" style={{ width: `${Math.min(100, d.level * 110)}%`, background: d.level > 0.95 ? "#FF6B8A" : DECK_COLOR[id] }} />
                  </div>
                </div>
              </div>
              <Slider
                label={`Deck ${id} filter`}
                value={d.filter}
                min={-1}
                max={1}
                step={0.01}
                onChange={(v) => !locked && act({ k: "filter", d: id, v })}
                valueText={Math.abs(d.filter) < 0.02 ? "off" : d.filter < 0 ? `LP ${Math.round(-d.filter * 100)}` : `HP ${Math.round(d.filter * 100)}`}
                accent={DECK_COLOR[id]}
              />
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted">
          <span style={{ color: DECK_COLOR.A }}>A</span>
          <span>Crossfader</span>
          <span style={{ color: DECK_COLOR.B }}>B</span>
        </div>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={snap.xf}
          disabled={locked}
          onChange={(e) => {
            act({ k: "xf", v: Number(e.currentTarget.value) });
          }}
          aria-label="Crossfader"
          aria-valuetext={snap.xf <= -0.99 ? "All deck A" : snap.xf >= 0.99 ? "All deck B" : `${Math.round(((1 - snap.xf) / 2) * 100)}% A, ${Math.round(((1 + snap.xf) / 2) * 100)}% B`}
          className="w-full"
          style={{ accentColor: "#C4B5FD" }}
        />
        <div className="grid grid-cols-3 gap-2">
          <Btn disabled={locked} onClick={() => act({ k: "xf", v: -1 })} label="Crossfader all the way to A">
            ⇤ A
          </Btn>
          <Btn disabled={locked} onClick={() => act({ k: "xf", v: 0 })} label="Crossfader to the middle">
            ⇔
          </Btn>
          <Btn disabled={locked} onClick={() => act({ k: "xf", v: 1 })} label="Crossfader all the way to B">
            B ⇥
          </Btn>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
        <span className="w-14 shrink-0">Phase</span>
        <div className="relative h-3 flex-1 rounded bg-surface-3" role="meter" aria-label="Beat phase between decks" aria-valuemin={-250} aria-valuemax={250} aria-valuenow={ph ?? 0} aria-valuetext={ph === null ? "Play both decks to compare" : Math.abs(ph) < 20 ? "In phase" : ph > 0 ? `B ahead by ${Math.round(ph)} ms` : `B behind by ${Math.round(-ph)} ms`}>
          <div className="absolute left-1/2 top-0 h-full w-0.5 bg-text/40" />
          {ph !== null ? <div className="absolute top-0 h-full w-2 rounded" style={{ left: `calc(${50 + Math.max(-50, Math.min(50, ph / 5))}% - 4px)`, background: Math.abs(ph) < 20 ? "#39FF88" : Math.abs(ph) < 50 ? "#F5A524" : "#FF6B8A" }} /> : null}
        </div>
        <span className="w-20 shrink-0 text-right font-mono tabular-nums">{ph === null ? "—" : `${ph > 0 ? "+" : ""}${Math.round(ph)} ms`}</span>
      </div>
    </section>
  );
}

export function CrowdMeter({ value }: { value: number }) {
  const mood = value >= 80 ? "🔥 Going off" : value >= 60 ? "🙌 Dancing" : value >= 40 ? "🙂 Nodding along" : value >= 20 ? "😐 Drifting" : "🚪 Leaving";
  return (
    <div className="flex items-center gap-2 text-xs" role="meter" aria-label="Crowd energy" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${value}%, ${mood}`}>
      <span className="font-bold uppercase tracking-wider text-muted">Crowd</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-surface-3">
        <div className="h-full transition-[width]" style={{ width: `${value}%`, background: value >= 60 ? "#39FF88" : value >= 35 ? "#F5A524" : "#FF6B8A" }} />
      </div>
      <span className="w-28 text-right">{mood}</span>
    </div>
  );
}
