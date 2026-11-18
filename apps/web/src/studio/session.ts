import { type DjEvent, type DjSetStats, type DjTrackRef, type PracticeCheck, VYBZ_PACK, camelotCompatible, packTrack, tempoCompatible } from "@vybz/core";
import { type Band, type DeckId, type LoadedTrack, Mixer, computePeaks, detectTempo, sha256Hex } from "./engine";

/**
 * One studio session: the mixer, the track cache, recording, the crowd meter
 * and practice checks. Every move goes through `apply`, so the controls,
 * lesson demos and set playback all behave the same and can be recorded.
 */

export interface DeckSnapshot {
  id: DeckId;
  title: string | null;
  artist: string | null;
  key: string | null;
  camelot: string | null;
  energy: number | null;
  nativeBpm: number | null;
  bpm: number | null;
  rate: number;
  playing: boolean;
  position: number;
  duration: number;
  cue: number;
  volume: number;
  eq: Record<Band, number>;
  filter: number;
  level: number;
  tapBpm: number | null;
  source: "VYBZ" | "LOCAL" | null;
}

export interface Snapshot {
  A: DeckSnapshot;
  B: DeckSnapshot;
  xf: number;
  phaseMs: number | null;
  recording: boolean;
  recordMs: number;
  crowd: number;
  stats: DjSetStats;
  practice: { passed: boolean; detail: string } | null;
  master: number;
}

type Listener = (s: Snapshot) => void;

export class StudioSession {
  readonly mixer: Mixer;
  private cache = new Map<string, Promise<LoadedTrack>>();
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private taps: Record<DeckId, number[]> = { A: [], B: [] };
  tapBpm: Record<DeckId, number | null> = { A: null, B: null };

  // Recording
  recording = false;
  private recStart = 0;
  recEvents: DjEvent[] = [];
  recTracks: DjTrackRef[] = [];
  private recKeys: string[] = [];
  recDurationMs = 0;

  // Stats while recording (or practising)
  private overlapMs = 0;
  private matchedMs = 0;
  private silentMs = 0;
  private longestSilence = 0;
  private started = false;
  private dominant: DeckId | null = null;
  private candidate: { id: DeckId; since: number } | null = null;
  transitions = 0;
  private bpmWeighted = 0;
  private bpmTime = 0;

  crowd = 50;
  private sameTrackMs = 0;
  loads: { deck: DeckId; key: string; energy: number | null; camelot: string | null; bpm: number }[] = [];
  practice: PracticeChecker | null = null;
  onEvent: ((e: Omit<DjEvent, "t">) => void) | null = null;

  constructor() {
    this.mixer = new Mixer();
    this.mixer.A.onEnded = () => this.emit();
    this.mixer.B.onEnded = () => this.emit();
  }

  start(): void {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), 100);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.mixer.close();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }

  // ── Tracks ───────────────────────────────────────────────────────────────

  loadPack(id: string): Promise<LoadedTrack> {
    const key = `vybz:${id}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const meta = packTrack(id);
    if (!meta) return Promise.reject(new Error("unknown track"));
    const p = (async () => {
      const res = await fetch(meta.file);
      if (!res.ok) throw new Error("couldn't load the track");
      const buffer = await this.mixer.ctx.decodeAudioData(await res.arrayBuffer());
      return {
        meta: { key, title: meta.title, artist: meta.artist, bpm: meta.bpm, camelot: meta.camelot, energy: meta.energy, firstBeat: 0, source: "VYBZ" as const, vybzId: id },
        buffer,
        peaks: computePeaks(buffer),
      };
    })();
    p.catch(() => this.cache.delete(key));
    this.cache.set(key, p);
    return p;
  }

  /** A file from the person's own device. Decoded here; never uploaded. */
  async addLocalFile(file: File): Promise<LoadedTrack> {
    const data = await file.arrayBuffer();
    const hash = await sha256Hex(data);
    const key = `local:${hash}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const p = (async () => {
      const buffer = await this.mixer.ctx.decodeAudioData(data.slice(0));
      const { bpm, firstBeat } = detectTempo(buffer);
      const name = file.name.replace(/\.[a-z0-9]+$/i, "");
      const [artist, title] = name.includes(" - ") ? name.split(" - ", 2) : ["Your file", name];
      return { meta: { key, title: title!.trim() || name, artist: artist!.trim(), bpm, camelot: null, energy: null, firstBeat, source: "LOCAL" as const, hash }, buffer, peaks: computePeaks(buffer) };
    })();
    p.catch(() => this.cache.delete(key));
    this.cache.set(key, p);
    return p;
  }

  localTrack(hash: string): Promise<LoadedTrack> | undefined {
    return this.cache.get(`local:${hash}`);
  }

  /** Change a device file's tempo reading (detection isn't perfect). */
  setNativeBpm(id: DeckId, bpm: number): void {
    const t = this.mixer.deck(id).track;
    if (!t || t.meta.source !== "LOCAL" || !(bpm >= 40 && bpm <= 250)) return;
    t.meta.bpm = bpm;
    this.emit();
  }

  // ── Moves ────────────────────────────────────────────────────────────────

  /** Loads a track on a deck and records it. */
  loadTrack(id: DeckId, t: LoadedTrack): void {
    this.mixer.deck(id).load(t);
    this.tapBpm[id] = null;
    this.taps[id] = [];
    this.sameTrackMs = 0;
    this.loads.push({ deck: id, key: t.meta.key, energy: t.meta.energy, camelot: t.meta.camelot, bpm: t.meta.bpm });
    if (this.recording) {
      let i = this.recKeys.indexOf(t.meta.key);
      if (i < 0) {
        i = this.recKeys.push(t.meta.key) - 1;
        this.recTracks.push(
          t.meta.source === "VYBZ"
            ? { source: "VYBZ", id: t.meta.vybzId! }
            : { source: "LOCAL", hash: t.meta.hash!, title: `${t.meta.artist} - ${t.meta.title}`, durationMs: Math.round(t.buffer.duration * 1000), bpm: t.meta.bpm },
        );
      }
      this.record({ k: "load", d: id, v: i });
      // Capture the deck's starting state so playback matches.
      const d = this.mixer.deck(id);
      this.record({ k: "tempo", d: id, v: d.rate });
    }
    this.practice?.onEvent({ k: "load", d: id }, this);
    this.onEvent?.({ k: "load", d: id });
    this.emit();
  }

  /**
   * Applies one move. `load` is handled by the caller (it needs a track);
   * positions are in ms; `seek` with v = -1 lines the deck up with the other.
   */
  apply(e: Omit<DjEvent, "t">, opts: { record?: boolean } = {}): void {
    const m = this.mixer;
    const d = e.d ? m.deck(e.d) : null;
    let rec: Omit<DjEvent, "t"> = e;
    switch (e.k) {
      case "play":
        if (!d?.track) return;
        if (typeof e.v === "number" && e.v >= 0) d.seek(e.v / 1000);
        d.play();
        rec = { k: "play", d: e.d, v: Math.round(d.position() * 1000) };
        if (!this.started) this.started = true;
        break;
      case "pause":
        d?.pause();
        if (d) rec = { k: "pause", d: e.d, v: Math.round(d.position() * 1000) };
        break;
      case "seek":
        if (!d?.track) return;
        if (e.v === -1) m.alignPhase(e.d!);
        else d.seek((e.v ?? 0) / 1000);
        rec = { k: "seek", d: e.d, v: Math.round(d.position() * 1000) };
        break;
      case "cue":
        if (!d?.track) return;
        d.cuePlay();
        if (!this.started) this.started = true;
        break;
      case "setcue":
        if (!d?.track) return;
        d.setCue(d.snap(typeof e.v === "number" ? e.v / 1000 : d.position()));
        rec = { k: "setcue", d: e.d, v: Math.round(d.cue * 1000) };
        break;
      case "tempo":
        if (!d || typeof e.v !== "number") return;
        d.setRate(Math.max(0.5, Math.min(2, e.v)));
        break;
      case "vol":
        if (!d || typeof e.v !== "number") return;
        d.setVolume(e.v);
        break;
      case "eq":
        if (!d || !e.b || typeof e.v !== "number") return;
        d.setEq(e.b, e.v);
        break;
      case "filter":
        if (!d || typeof e.v !== "number") return;
        d.setFilter(e.v);
        break;
      case "xf":
        if (typeof e.v !== "number") return;
        m.setCrossfader(e.v);
        break;
      default:
        return;
    }
    if (opts.record !== false && this.recording) this.record(rec);
    this.practice?.onEvent(rec, this);
    this.onEvent?.(rec);
    this.emit();
  }

  sync(id: DeckId): void {
    this.mixer.sync(id);
    const d = this.mixer.deck(id);
    if (this.recording) {
      this.record({ k: "tempo", d: id, v: d.rate });
      this.record({ k: "seek", d: id, v: Math.round(d.position() * 1000) });
    }
    this.emit();
  }

  /** Hold-to-nudge: bends the deck's speed while held. Recorded as the resulting seek on release. */
  bend(id: DeckId, dir: -1 | 0 | 1): void {
    const d = this.mixer.deck(id);
    d.setBend(dir);
    if (dir === 0 && this.recording && d.track) this.record({ k: "seek", d: id, v: Math.round(d.position() * 1000) });
    this.emit();
  }

  tap(id: DeckId): void {
    const now = performance.now();
    const t = this.taps[id].filter((x) => now - x < 3000);
    t.push(now);
    this.taps[id] = t.slice(-12);
    if (this.taps[id].length >= 4) {
      const iv = this.taps[id].slice(1).map((x, i) => x - this.taps[id][i]!);
      const avg = iv.reduce((a, b) => a + b, 0) / iv.length;
      this.tapBpm[id] = Math.round((60000 / avg) * 10) / 10;
    }
    this.practice?.onTap(id, this);
    this.emit();
  }

  // ── Recording ────────────────────────────────────────────────────────────

  startRecording(): void {
    this.recording = true;
    this.recStart = performance.now();
    this.recEvents = [];
    this.recTracks = [];
    this.recKeys = [];
    this.recDurationMs = 0;
    this.resetStats();
    // Starting state: what's on the decks and how the mixer is set.
    for (const id of ["A", "B"] as const) {
      const d = this.mixer.deck(id);
      if (d.track) {
        const t = d.track;
        const i = this.recKeys.push(t.meta.key) - 1;
        this.recTracks.push(
          t.meta.source === "VYBZ"
            ? { source: "VYBZ", id: t.meta.vybzId! }
            : { source: "LOCAL", hash: t.meta.hash!, title: `${t.meta.artist} - ${t.meta.title}`, durationMs: Math.round(t.buffer.duration * 1000), bpm: t.meta.bpm },
        );
        this.record({ k: "load", d: id, v: i });
        this.record({ k: "seek", d: id, v: Math.round(d.position() * 1000) });
        this.record({ k: "setcue", d: id, v: Math.round(d.cue * 1000) });
      }
      this.record({ k: "tempo", d: id, v: d.rate });
      this.record({ k: "vol", d: id, v: d.volume });
      for (const b of ["low", "mid", "high"] as const) this.record({ k: "eq", d: id, b, v: d.eq[b] });
      this.record({ k: "filter", d: id, v: d.filter });
      if (d.playing) this.record({ k: "play", d: id, v: Math.round(d.position() * 1000) });
    }
    this.record({ k: "xf", v: this.mixer.xf });
    this.emit();
  }

  stopRecording(): { events: DjEvent[]; tracks: DjTrackRef[]; durationMs: number; stats: DjSetStats } {
    this.recDurationMs = Math.round(performance.now() - this.recStart);
    this.record({ k: "end" });
    this.recording = false;
    this.practice?.onRecordingDone(this);
    this.emit();
    return { events: this.recEvents, tracks: this.recTracks, durationMs: this.recDurationMs, stats: this.stats() };
  }

  private record(e: Omit<DjEvent, "t">): void {
    this.recEvents.push({ t: Math.round(performance.now() - this.recStart), ...e });
  }

  resetStats(): void {
    this.overlapMs = 0;
    this.matchedMs = 0;
    this.silentMs = 0;
    this.longestSilence = 0;
    this.transitions = 0;
    this.dominant = null;
    this.candidate = null;
    this.bpmWeighted = 0;
    this.bpmTime = 0;
    this.started = this.mixer.A.playing || this.mixer.B.playing;
  }

  stats(): DjSetStats {
    return {
      transitions: this.transitions,
      beatmatchPct: this.overlapMs >= 1000 ? Math.round((100 * this.matchedMs) / this.overlapMs) : null,
      longestSilenceMs: Math.round(this.longestSilence),
      averageBpm: this.bpmTime ? Math.round((this.bpmWeighted / this.bpmTime) * 10) / 10 : null,
    };
  }

  // ── The clock ────────────────────────────────────────────────────────────

  beatmatched(maxBpmDiff = 0.5, maxPhaseMs = 50): boolean {
    const { A, B } = this.mixer;
    if (!A.track || !B.track || !A.playing || !B.playing) return false;
    let a = A.bpm();
    const b = B.bpm();
    if (a / b > 1.5) a /= 2;
    if (b / a > 1.5) a *= 2;
    const ph = this.mixer.phaseOffsetMs();
    return Math.abs(a - b) <= maxBpmDiff && ph !== null && Math.abs(ph) <= maxPhaseMs;
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(500, now - this.lastTick);
    this.lastTick = now;
    const m = this.mixer;
    const a = m.audibility("A");
    const b = m.audibility("B");
    const anyPlaying = m.A.playing || m.B.playing;
    if (anyPlaying) this.started = true;
    const overlap = a > 0.1 && b > 0.1;
    const matched = overlap && this.beatmatched();
    if (this.started) {
      if (a < 0.05 && b < 0.05) {
        this.silentMs += dt;
        this.longestSilence = Math.max(this.longestSilence, this.silentMs);
      } else {
        this.silentMs = 0;
      }
    }
    if (overlap) {
      this.overlapMs += dt;
      if (matched) this.matchedMs += dt;
    }
    // Transitions: the loudest deck changes and stays loudest for 1.5s.
    const top: DeckId | null = Math.max(a, b) > 0.1 ? (a >= b ? "A" : "B") : null;
    if (top && top !== this.dominant) {
      if (!this.candidate || this.candidate.id !== top) this.candidate = { id: top, since: now };
      else if (now - this.candidate.since > 1500) {
        if (this.dominant) {
          this.transitions++;
          this.crowd += matched || this.overlapMs > 0 ? 6 : 2;
          this.sameTrackMs = 0;
        }
        this.dominant = top;
        this.candidate = null;
      }
    } else {
      this.candidate = null;
    }
    if (top) {
      this.bpmWeighted += m.deck(top).bpm() * dt;
      this.bpmTime += dt;
    }
    // Crowd: music keeps people dancing, clean blends lift them, silence and clashes don't.
    const s = dt / 1000;
    if (this.started && !top) this.crowd -= 14 * s;
    else if (overlap && !matched) this.crowd -= 6 * s;
    else if (matched) this.crowd += 2.5 * s;
    else if (top) {
      this.sameTrackMs += dt;
      this.crowd += this.sameTrackMs > 90_000 ? -1 * s : 0.8 * s;
    }
    this.crowd = Math.max(0, Math.min(100, this.crowd));
    this.practice?.onTick(dt, this);
    this.emit();
  }

  snapshot(): Snapshot {
    const deck = (id: DeckId): DeckSnapshot => {
      const d = this.mixer.deck(id);
      const t = d.track?.meta;
      const pack = t?.vybzId ? packTrack(t.vybzId) : undefined;
      return {
        id,
        title: t?.title ?? null,
        artist: t?.artist ?? null,
        key: pack?.key ?? null,
        camelot: t?.camelot ?? null,
        energy: t?.energy ?? null,
        nativeBpm: t?.bpm ?? null,
        bpm: t ? d.bpm() : null,
        rate: d.rate,
        playing: d.playing,
        position: d.position(),
        duration: d.duration,
        cue: d.cue,
        volume: d.volume,
        eq: { ...d.eq },
        filter: d.filter,
        level: d.playing ? d.level() : 0,
        tapBpm: this.tapBpm[id],
        source: t?.source ?? null,
      };
    };
    return {
      A: deck("A"),
      B: deck("B"),
      xf: this.mixer.xf,
      phaseMs: this.mixer.A.playing && this.mixer.B.playing ? this.mixer.phaseOffsetMs() : null,
      recording: this.recording,
      recordMs: this.recording ? performance.now() - this.recStart : this.recDurationMs,
      crowd: Math.round(this.crowd),
      stats: this.stats(),
      practice: this.practice ? { passed: this.practice.passed, detail: this.practice.detail } : null,
      master: 0,
    };
  }
}

// ── Practice checks ────────────────────────────────────────────────────────

export class PracticeChecker {
  passed = false;
  detail = "";
  private hold = 0;
  private seq: string[] = [];
  private xfStart: number | null = null;
  private xfFromLeft = false;
  private overlapMatched = 0;
  private setCueOnBeat = false;

  constructor(readonly check: PracticeCheck) {
    this.detail = this.initial();
  }

  private initial(): string {
    switch (this.check.type) {
      case "transport":
        return "Load → Play → Pause → Cue";
      case "tapTempo":
        return "Tap along with deck A";
      case "beatmatch":
        return "Match tempo and phase";
      case "cue":
        return "Set a cue on deck B, then press Cue";
      case "crossfade":
        return "Crossfader: all the way left to all the way right";
      case "eqSwap":
        return "Cut deck A's low, keep deck B's open";
      case "transition":
        return "Blend from A to B";
      case "selection":
        return "Load a compatible track on deck B";
      case "energy":
        return "Load three tracks with rising energy";
      case "crowd":
        return "Keep the crowd above 60%";
      case "battleSet":
        return "Record a 30s–3min set with 2+ transitions";
    }
  }

  private pass(msg: string) {
    if (this.passed) return;
    this.passed = true;
    this.detail = msg;
  }

  onEvent(e: Omit<DjEvent, "t">, s: StudioSession): void {
    if (this.passed) return;
    const c = this.check;
    if (c.type === "transport") {
      const step = e.k === "load" ? "load" : e.k === "play" ? "play" : e.k === "pause" ? "pause" : e.k === "cue" ? "cue" : null;
      if (!step) return;
      const want = ["load", "play", "pause", "cue"];
      const next = want[this.seq.length];
      if (step === next) this.seq.push(step);
      else if (step === "load") this.seq = ["load"];
      this.detail = `${this.seq.length}/4 · ${want.map((w, i) => (i < this.seq.length ? `✓ ${w}` : w)).join(" → ")}`;
      if (this.seq.length === 4) this.pass("Nice: load, play, pause and cue all done.");
    }
    if (c.type === "cue" && e.d === "B") {
      if (e.k === "setcue" && typeof e.v === "number" && e.v >= 0) {
        const d = s.mixer.B;
        const off = Math.abs(e.v / 1000 - d.snap(e.v / 1000)) * 1000;
        this.setCueOnBeat = off <= c.maxOffBeatMs;
        this.detail = this.setCueOnBeat ? "Cue set on a beat. Now press Cue." : "Set the cue on a beat.";
      }
      if (e.k === "cue" && this.setCueOnBeat) this.pass("Spot on: deck B started right on the beat.");
    }
    if (c.type === "selection" && e.k === "load" && e.d === "B") {
      const a = s.mixer.A.track?.meta;
      const b = s.mixer.B.track?.meta;
      if (a && b && b.key !== a.key) {
        const ok = tempoCompatible(b.bpm, a.bpm, 0.08) && !!a.camelot && !!b.camelot && camelotCompatible(a.camelot, b.camelot);
        if (ok) this.pass(`${b.title} (${b.bpm} BPM, ${b.camelot}) fits after ${a.title}.`);
        else this.detail = `${b.title} is ${!tempoCompatible(b.bpm, a.bpm, 0.08) ? "too far in tempo" : "in a clashing key"}. Try another.`;
      }
    }
    if (c.type === "energy" && e.k === "load") {
      const last = s.loads.slice(-c.tracks);
      const distinct = new Set(last.map((l) => l.key)).size === last.length;
      const rising = last.every((l, i) => i === 0 || (l.energy ?? 0) >= (last[i - 1]!.energy ?? 0));
      this.detail = `${last.map((l) => l.energy ?? "?").join(" → ")}${rising ? "" : " (that one dropped)"}`;
      if (last.length === c.tracks && distinct && rising) this.pass(`Energy ${last.map((l) => l.energy).join(" → ")}: a proper build.`);
    }
  }

  onTap(id: DeckId, s: StudioSession): void {
    const c = this.check;
    if (this.passed || c.type !== "tapTempo" || id !== "A") return;
    const tapped = s.tapBpm.A;
    const real = s.mixer.A.bpm();
    if (tapped && real) {
      this.detail = `You tapped ${tapped} BPM`;
      if (Math.abs(tapped - real) <= c.toleranceBpm && s.mixer.A.playing) this.pass(`You tapped ${tapped}; it's ${real.toFixed(1)}. Great ears.`);
    } else {
      this.detail = "Keep tapping…";
    }
  }

  onTick(dt: number, s: StudioSession): void {
    if (this.passed) return;
    const c = this.check;
    const m = s.mixer;
    const a = m.audibility("A");
    const b = m.audibility("B");
    if (c.type === "beatmatch") {
      const ok = a > 0.1 && b > 0.1 && s.beatmatched(c.maxBpmDiff, c.maxPhaseMs);
      this.hold = ok ? this.hold + dt : 0;
      this.detail = ok ? `Locked ${(this.hold / 1000).toFixed(1)}s / ${c.holdMs / 1000}s` : a > 0.1 && b > 0.1 ? "Both audible. Match the BPM and line up the kicks." : "Play both decks with the crossfader in the middle.";
      if (this.hold >= c.holdMs) this.pass("Locked in for 8 seconds. That's beatmatching.");
    }
    if (c.type === "crossfade") {
      const both = m.A.playing && m.B.playing;
      if (!both) {
        this.detail = "Play both decks.";
        this.xfStart = null;
        return;
      }
      if (m.xf <= -0.95) {
        this.xfStart = performance.now();
        this.xfFromLeft = true;
        this.detail = "Now move it slowly to the right.";
      } else if (this.xfFromLeft && this.xfStart && m.xf >= 0.95) {
        const took = performance.now() - this.xfStart;
        if (took >= c.minMs) this.pass(`Smooth: ${(took / 1000).toFixed(1)} seconds from A to B.`);
        else {
          this.detail = `Too quick (${(took / 1000).toFixed(1)}s). Go back left and take at least ${c.minMs / 1000}s.`;
          this.xfFromLeft = false;
        }
      } else if (this.xfFromLeft && this.xfStart) {
        this.detail = `Blending… ${((performance.now() - this.xfStart) / 1000).toFixed(1)}s`;
      } else {
        this.detail = "Start with the crossfader all the way left.";
      }
    }
    if (c.type === "eqSwap") {
      const ok = a > 0.1 && b > 0.1 && m.A.eq.low <= -12 && m.B.eq.low >= -1;
      this.hold = ok ? this.hold + dt : 0;
      this.detail = ok ? `Bass swapped ${(this.hold / 1000).toFixed(1)}s / ${c.holdMs / 1000}s` : `A low ${m.A.eq.low.toFixed(0)} dB · B low ${m.B.eq.low.toFixed(0)} dB`;
      if (this.hold >= c.holdMs) this.pass("Clean bass swap: only one bassline at a time.");
    }
    if (c.type === "transition") {
      if (a > 0.1 && b > 0.1 && s.beatmatched(c.maxBpmDiff, 60)) this.overlapMatched += dt;
      const done = this.overlapMatched >= c.minOverlapMs;
      this.detail = done ? "Now finish on deck B alone." : `Beatmatched overlap ${(this.overlapMatched / 1000).toFixed(1)}s / ${c.minOverlapMs / 1000}s`;
      if (done && b > 0.1 && a < 0.05) this.pass("Full transition done: A out, B in, in time.");
    }
    if (c.type === "crowd") {
      this.hold = s.crowd >= c.minEnergy ? this.hold + dt : 0;
      this.detail = `Crowd ${Math.round(s.crowd)}% · held ${(this.hold / 1000).toFixed(0)}s / ${c.holdMs / 1000}s`;
      if (this.hold >= c.holdMs) this.pass("The floor's full. You read the room.");
    }
    if (c.type === "battleSet" && s.recording) {
      this.detail = `Recording… ${s.transitions} transition${s.transitions === 1 ? "" : "s"}`;
    }
  }

  onRecordingDone(s: StudioSession): void {
    if (this.passed || this.check.type !== "battleSet") return;
    const st = s.stats();
    const secs = s.recDurationMs / 1000;
    const vybz = s.recTracks.every((t) => t.source === "VYBZ");
    if (secs < 30 || secs > 180) this.detail = `That was ${secs.toFixed(0)}s. Battle sets run 30s to 3 minutes.`;
    else if (st.transitions < this.check.minTransitions) this.detail = `${st.transitions} transition${st.transitions === 1 ? "" : "s"}; you need ${this.check.minTransitions}.`;
    else if (st.longestSilenceMs > 1000) this.detail = `There was ${(st.longestSilenceMs / 1000).toFixed(1)}s of silence. Keep the music going.`;
    else if (!vybz) this.detail = "Battle sets use VYBZ pack tracks only.";
    else this.pass(`Battle-ready: ${secs.toFixed(0)}s, ${st.transitions} transitions${st.beatmatchPct !== null ? `, ${st.beatmatchPct}% beatmatched` : ""}.`);
  }
}

export { VYBZ_PACK };
