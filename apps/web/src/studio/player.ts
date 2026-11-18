import type { DjEvent, DjSetView, DjTrackRef } from "@vybz/core";
import type { LoadedTrack } from "./engine";
import type { StudioSession } from "./session";

/**
 * Replays a saved set from its move log on the studio's decks. Tracks are
 * loaded first: VYBZ pack tracks from the pack, device files only if the
 * listener has the same file (matched by hash) loaded in this session.
 */
export class SetPlayer {
  private raf = 0;
  private start = 0;
  private i = 0;
  private tracks: LoadedTrack[] = [];
  playing = false;
  elapsedMs = 0;
  onProgress: ((ms: number) => void) | null = null;
  onDone: (() => void) | null = null;

  constructor(
    private readonly session: StudioSession,
    readonly set: DjSetView & { events: DjEvent[] },
  ) {}

  /** Device files this set needs that aren't loaded. */
  missing(): Extract<DjTrackRef, { source: "LOCAL" }>[] {
    return this.set.tracks.filter((t): t is Extract<DjTrackRef, { source: "LOCAL" }> => t.source === "LOCAL" && !this.session.localTrack(t.hash));
  }

  async prepare(): Promise<void> {
    this.tracks = await Promise.all(
      this.set.tracks.map((t) => {
        if (t.source === "VYBZ") return this.session.loadPack(t.id);
        const p = this.session.localTrack(t.hash);
        if (!p) throw new Error(`Add "${t.title}" from your device to play this set.`);
        return p;
      }),
    );
  }

  play(): void {
    this.stop();
    const m = this.session.mixer;
    // Start from a neutral mixer; the set's own opening moves set it up.
    for (const d of ["A", "B"] as const) {
      this.session.apply({ k: "pause", d }, { record: false });
      this.session.apply({ k: "tempo", d, v: 1 }, { record: false });
      this.session.apply({ k: "vol", d, v: 1 }, { record: false });
      for (const b of ["low", "mid", "high"] as const) this.session.apply({ k: "eq", d, b, v: 0 }, { record: false });
      this.session.apply({ k: "filter", d, v: 0 }, { record: false });
    }
    this.session.apply({ k: "xf", v: 0 }, { record: false });
    this.i = 0;
    this.elapsedMs = 0;
    this.playing = true;
    this.start = performance.now();
    const step = () => {
      if (!this.playing) return;
      this.elapsedMs = performance.now() - this.start;
      const ev = this.set.events;
      while (this.i < ev.length && ev[this.i]!.t <= this.elapsedMs) {
        const e = ev[this.i++]!;
        if (e.k === "end") {
          this.finish();
          return;
        }
        if (e.k === "load" && e.d && typeof e.v === "number") {
          const t = this.tracks[e.v];
          if (t) this.session.mixer.deck(e.d).load(t);
          continue;
        }
        this.session.apply(e, { record: false });
      }
      this.onProgress?.(this.elapsedMs);
      if (this.elapsedMs >= this.set.durationMs + 500) {
        this.finish();
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private finish(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.session.mixer.A.pause();
    this.session.mixer.B.pause();
    this.onProgress?.(this.set.durationMs);
    this.onDone?.();
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.session.mixer.A.pause();
    this.session.mixer.B.pause();
  }
}
