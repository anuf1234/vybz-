/**
 * DJ Vybz Studio audio engine (Web Audio). Two decks, each:
 *   source → 3-band EQ → filter (LP/HP) → channel volume → crossfader gain → master
 * Tempo works like a turntable's pitch fader (speed and pitch move together).
 * Audio is decoded in the browser from the VYBZ pack or a file on the
 * device; nothing is uploaded or re-hosted.
 */

export type DeckId = "A" | "B";
export type Band = "low" | "mid" | "high";

export interface TrackMeta {
  /** Stable key: "vybz:<id>" or "local:<hash>". */
  key: string;
  title: string;
  artist: string;
  /** Native tempo. */
  bpm: number;
  camelot: string | null;
  energy: number | null;
  /** Seconds to the first beat. */
  firstBeat: number;
  source: "VYBZ" | "LOCAL";
  vybzId?: string;
  hash?: string;
}

export interface LoadedTrack {
  meta: TrackMeta;
  buffer: AudioBuffer;
  /** Min/max pairs for the overview waveform. */
  peaks: Float32Array;
}

export const EQ_MIN = -26;
export const EQ_MAX = 6;
const BEND = 0.04;

function dbClamp(v: number) {
  return Math.max(EQ_MIN, Math.min(EQ_MAX, v));
}

export class Deck {
  readonly input: GainNode;
  private readonly low: BiquadFilterNode;
  private readonly mid: BiquadFilterNode;
  private readonly high: BiquadFilterNode;
  private readonly lp: BiquadFilterNode;
  private readonly hp: BiquadFilterNode;
  readonly channel: GainNode;
  readonly xfGain: GainNode;
  readonly analyser: AnalyserNode;

  track: LoadedTrack | null = null;
  playing = false;
  /** Tempo multiplier from the pitch fader. */
  rate = 1;
  /** -1, 0 or 1 while a nudge button is held. */
  bend = 0;
  cue = 0;
  volume = 1;
  eq: Record<Band, number> = { low: 0, mid: 0, high: 0 };
  filter = 0;
  private source: AudioBufferSourceNode | null = null;
  private anchorCtx = 0;
  private anchorPos = 0;
  onEnded: (() => void) | null = null;

  constructor(
    readonly id: DeckId,
    private readonly ctx: AudioContext,
    out: AudioNode,
  ) {
    this.input = ctx.createGain();
    this.low = ctx.createBiquadFilter();
    this.low.type = "lowshelf";
    this.low.frequency.value = 220;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = "peaking";
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 0.7;
    this.high = ctx.createBiquadFilter();
    this.high.type = "highshelf";
    this.high.frequency.value = 3800;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 22000;
    this.hp = ctx.createBiquadFilter();
    this.hp.type = "highpass";
    this.hp.frequency.value = 10;
    this.channel = ctx.createGain();
    this.xfGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.input.connect(this.low).connect(this.mid).connect(this.high).connect(this.lp).connect(this.hp).connect(this.channel).connect(this.xfGain);
    this.xfGain.connect(out);
    this.channel.connect(this.analyser);
  }

  get effectiveRate(): number {
    return this.rate * (1 + this.bend * BEND);
  }

  get duration(): number {
    return this.track?.buffer.duration ?? 0;
  }

  /** Seconds into the track. */
  position(): number {
    if (!this.playing) return this.anchorPos;
    return Math.min(this.duration, this.anchorPos + (this.ctx.currentTime - this.anchorCtx) * this.effectiveRate);
  }

  bpm(): number {
    return (this.track?.meta.bpm ?? 0) * this.rate;
  }

  beatLength(): number {
    const b = this.track?.meta.bpm ?? 120;
    return 60 / b;
  }

  /** Beats since the first beat, in track time. */
  beatPosition(at = this.position()): number {
    return (at - (this.track?.meta.firstBeat ?? 0)) / this.beatLength();
  }

  load(t: LoadedTrack): void {
    this.stopSource();
    this.track = t;
    this.playing = false;
    this.anchorPos = 0;
    this.cue = t.meta.firstBeat;
    this.anchorPos = this.cue;
  }

  play(): void {
    if (!this.track || this.playing) return;
    if (this.anchorPos >= this.duration - 0.05) this.anchorPos = this.cue;
    this.startSource(this.anchorPos);
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.anchorPos = this.position();
    this.stopSource();
    this.playing = false;
  }

  seek(pos: number): void {
    if (!this.track) return;
    const p = Math.max(0, Math.min(this.duration - 0.01, pos));
    if (this.playing) {
      this.stopSource();
      this.startSource(p);
    } else {
      this.anchorPos = p;
    }
  }

  /** Jump to the cue point and play. */
  cuePlay(): void {
    this.seek(this.cue);
    this.play();
  }

  /** Nearest beat to `pos` (snaps cue points to the grid). */
  snap(pos: number): number {
    const fb = this.track?.meta.firstBeat ?? 0;
    const bl = this.beatLength();
    return Math.max(0, fb + Math.round((pos - fb) / bl) * bl);
  }

  setCue(pos: number): void {
    this.cue = Math.max(0, Math.min(this.duration, pos));
  }

  setRate(r: number): void {
    this.reanchor();
    this.rate = r;
    this.applyRate();
  }

  setBend(dir: -1 | 0 | 1): void {
    this.reanchor();
    this.bend = dir;
    this.applyRate();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.channel.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
  }

  setEq(band: Band, db: number): void {
    this.eq[band] = dbClamp(db);
    const node = band === "low" ? this.low : band === "mid" ? this.mid : this.high;
    // A full cut is a kill: shelves can't reach silence, so drop a little further.
    node.gain.setTargetAtTime(this.eq[band] <= EQ_MIN ? -40 : this.eq[band], this.ctx.currentTime, 0.01);
  }

  /** -1 (low-pass, dark) … 0 (off) … 1 (high-pass, thin). */
  setFilter(v: number): void {
    this.filter = Math.max(-1, Math.min(1, v));
    const t = this.ctx.currentTime;
    const lp = this.filter < 0 ? 22000 * Math.pow(200 / 22000, -this.filter) : 22000;
    const hp = this.filter > 0 ? 10 * Math.pow(6000 / 10, this.filter) : 10;
    this.lp.frequency.setTargetAtTime(lp, t, 0.02);
    this.hp.frequency.setTargetAtTime(hp, t, 0.02);
  }

  /** Linear level of the channel right now, 0–1 (for meters). */
  level(): number {
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  private reanchor(): void {
    this.anchorPos = this.position();
    this.anchorCtx = this.ctx.currentTime;
  }

  private applyRate(): void {
    this.source?.playbackRate.setValueAtTime(this.effectiveRate, this.ctx.currentTime);
  }

  private startSource(pos: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.track!.buffer;
    src.playbackRate.value = this.effectiveRate;
    src.connect(this.input);
    src.onended = () => {
      if (this.source !== src) return;
      this.anchorPos = this.duration;
      this.source = null;
      this.playing = false;
      this.onEnded?.();
    };
    src.start(0, pos);
    this.source = src;
    this.anchorCtx = this.ctx.currentTime;
    this.anchorPos = pos;
  }

  private stopSource(): void {
    const s = this.source;
    this.source = null;
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
  }
}

export class Mixer {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly analyser: AnalyserNode;
  readonly A: Deck;
  readonly B: Deck;
  /** -1 = all A, 1 = all B. */
  xf = 0;

  constructor() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(limiter).connect(this.ctx.destination);
    limiter.connect(this.analyser);
    this.A = new Deck("A", this.ctx, this.master);
    this.B = new Deck("B", this.ctx, this.master);
    this.setCrossfader(0);
  }

  deck(id: DeckId): Deck {
    return id === "A" ? this.A : this.B;
  }

  other(id: DeckId): Deck {
    return id === "A" ? this.B : this.A;
  }

  /** Equal-power curve so the middle isn't a volume dip. */
  static xfGains(x: number): { A: number; B: number } {
    const p = ((Math.max(-1, Math.min(1, x)) + 1) / 2) * (Math.PI / 2);
    return { A: Math.cos(p), B: Math.sin(p) };
  }

  setCrossfader(x: number): void {
    this.xf = Math.max(-1, Math.min(1, x));
    const g = Mixer.xfGains(this.xf);
    const t = this.ctx.currentTime;
    this.A.xfGain.gain.setTargetAtTime(g.A, t, 0.008);
    this.B.xfGain.gain.setTargetAtTime(g.B, t, 0.008);
  }

  /** How loud each deck is in the mix (0–1), ignoring the music itself. */
  audibility(id: DeckId): number {
    const d = this.deck(id);
    if (!d.playing || !d.track) return 0;
    return d.volume * Mixer.xfGains(this.xf)[id];
  }

  /** Phase offset between the decks' beats in ms (−half a beat … +half a beat), or null. */
  phaseOffsetMs(): number | null {
    if (!this.A.track || !this.B.track) return null;
    const pa = this.A.beatPosition();
    const pb = this.B.beatPosition();
    let d = (pb % 1) - (pa % 1);
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    const beatMs = (60 / Math.max(1, this.A.bpm())) * 1000;
    return d * beatMs;
  }

  /** Matches `id`'s tempo to the other deck (handles half/double time) and lines up its beat. */
  sync(id: DeckId): void {
    const d = this.deck(id);
    const o = this.other(id);
    if (!d.track || !o.track) return;
    let target = o.bpm();
    const native = d.track.meta.bpm;
    if (target / native > 1.5) target /= 2;
    if (native / target > 1.5) target *= 2;
    d.setRate(target / native);
    this.alignPhase(id);
  }

  /** Moves `id` by less than half a beat so its beats land on the other deck's. */
  alignPhase(id: DeckId): void {
    const d = this.deck(id);
    const o = this.other(id);
    if (!d.track || !o.track) return;
    const po = o.beatPosition() % 1;
    const pd = d.beatPosition() % 1;
    let diff = po - pd;
    if (diff > 0.5) diff -= 1;
    if (diff < -0.5) diff += 1;
    // Near the start of the track there's no room to go back: go forward a beat instead.
    let target = d.position() + diff * d.beatLength();
    if (target < 0) target += d.beatLength();
    d.seek(target);
  }

  async resume(): Promise<void> {
    // iOS: let Web Audio play with the ringer switch on silent.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "playback";
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  close(): void {
    this.A.pause();
    this.B.pause();
    void this.ctx.close();
  }
}

// ── Analysis ───────────────────────────────────────────────────────────────

export function computePeaks(buffer: AudioBuffer, buckets = 1200): Float32Array {
  const ch = buffer.getChannelData(0);
  const ch2 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch;
  const size = Math.max(1, Math.floor(ch.length / buckets));
  const out = new Float32Array(buckets * 2);
  for (let b = 0; b < buckets; b++) {
    let min = 0;
    let max = 0;
    const start = b * size;
    for (let i = start; i < start + size && i < ch.length; i += 4) {
      const v = (ch[i]! + ch2[i]!) / 2;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}

/**
 * Estimates tempo and the first beat for a device file: an onset envelope
 * from low-band energy, autocorrelated over 70–180 BPM.
 */
export function detectTempo(buffer: AudioBuffer): { bpm: number; firstBeat: number } {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const hop = 512;
  const maxSeconds = Math.min(buffer.duration, 60);
  const frames = Math.floor((maxSeconds * sr) / hop);
  const env = new Float32Array(frames);
  let lp = 0;
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      lp += 0.05 * ((data[i] ?? 0) - lp);
      e += lp * lp;
    }
    env[f] = Math.max(0, e - prev);
    prev = e;
  }
  const fps = sr / hop;
  let best = 120;
  let bestScore = -1;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    let s = 0;
    for (let f = 0; f + lag * 4 < frames; f++) {
      const l = Math.round(f + lag);
      const l2 = Math.round(f + lag * 2);
      s += env[f]! * (env[l]! + 0.5 * env[l2]!);
    }
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  // Phase: the offset within one beat where onsets line up best.
  const lag = (60 / best) * fps;
  let bestOff = 0;
  let bestSum = -1;
  for (let off = 0; off < lag; off++) {
    let s = 0;
    for (let k = off; k < frames; k += lag) s += env[Math.round(k)] ?? 0;
    if (s > bestSum) {
      bestSum = s;
      bestOff = off;
    }
  }
  return { bpm: Math.round(best * 10) / 10, firstBeat: bestOff / fps };
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
