/**
 * Counts how long a track has actually been audible (wall time while playing),
 * not the playhead position, so seeking ahead doesn't count as listening.
 * Pure so it can be unit-tested; the player feeds it play/pause events.
 */
export class ListenTracker {
  private accumulated = 0;
  private playingSince: number | null = null;

  constructor(initialMs = 0) {
    this.accumulated = initialMs;
  }

  play(now: number) {
    if (this.playingSince === null) this.playingSince = now;
  }

  pause(now: number) {
    if (this.playingSince !== null) {
      this.accumulated += Math.max(0, now - this.playingSince);
      this.playingSince = null;
    }
  }

  get isPlaying() {
    return this.playingSince !== null;
  }

  playedMs(now: number): number {
    return this.accumulated + (this.playingSince !== null ? Math.max(0, now - this.playingSince) : 0);
  }

  /** Never go below what the server already credited. */
  sync(serverMs: number) {
    if (serverMs > this.accumulated && this.playingSince === null) this.accumulated = serverMs;
  }
}
