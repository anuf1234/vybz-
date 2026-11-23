"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Plays the battle's picks on a big screen (a TV, a laptop on a projector,
 * or a stream). The person running the screen chooses where the music comes
 * from, and it plays through their own access:
 *  - YouTube: the visible YouTube player (YouTube's own embed; never audio-only).
 *  - Apple Music: MusicKit with their Apple Music sign-in (full songs for subscribers).
 *  - Previews: Apple's 30-second previews, no sign-in.
 * Nothing is downloaded, proxied or mixed: one song at a time, start to stop.
 * Off by default; picking a source is the click browsers need before audio.
 */

export interface ScreenTrack {
  key: string;
  title: string;
  artist: string;
  previewUrl?: string | null;
  appleId?: string | null;
  youtubeId?: string | null;
  durationMs?: number | null;
}

export type MusicSource = "off" | "preview" | "youtube" | "apple";

declare global {
  interface Window {
    MusicKit?: {
      configure(o: { developerToken: string; app: { name: string; build: string } }): Promise<MusicKitInstance>;
      getInstance(): MusicKitInstance | undefined;
    };
  }
}
interface MusicKitInstance {
  isAuthorized: boolean;
  authorize(): Promise<string>;
  setQueue(o: { song: string; startPlaying?: boolean }): Promise<unknown>;
  play(): Promise<void>;
  stop(): void;
  seekToTime(s: number): Promise<void>;
}

let musicKit: Promise<MusicKitInstance> | null = null;

/** Loads MusicKit JS and signs the person in to Apple Music (their own account). */
function appleMusic(): Promise<MusicKitInstance> {
  musicKit ??= (async () => {
    const res = await fetch("/api/v1/me/music/apple/developer-token", { cache: "no-store" });
    if (res.status === 401) throw new Error("Sign in to VYBZ on this screen to use Apple Music.");
    if (!res.ok) throw new Error("Apple Music isn't available right now.");
    const { token } = (await res.json()) as { token: string };
    if (!window.MusicKit) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Couldn't load Apple Music."));
        document.head.appendChild(s);
      });
      for (let i = 0; i < 50 && !window.MusicKit; i++) await new Promise((r) => setTimeout(r, 100));
    }
    if (!window.MusicKit) throw new Error("Couldn't load Apple Music.");
    const mk = await window.MusicKit.configure({ developerToken: token, app: { name: "VYBZ", build: "1.0" } });
    if (!mk.isAuthorized) await mk.authorize();
    return mk;
  })().catch((err) => {
    musicKit = null;
    throw err;
  });
  return musicKit;
}

/** Where a clip starts: the top for previews, past the intro for full songs. */
function startAt(t: ScreenTrack, source: MusicSource, clipSec: number): number {
  if (source === "preview") return 0;
  const total = (t.durationMs ?? 0) / 1000;
  return total > clipSec + 60 ? 30 : 0;
}

/** What this track can play on, best first, for the chosen source. */
function pick(t: ScreenTrack, source: MusicSource): MusicSource | null {
  const order: MusicSource[] = source === "apple" ? ["apple", "preview", "youtube"] : source === "youtube" ? ["youtube", "preview"] : ["preview", "youtube"];
  for (const s of order) {
    if (s === "apple" && t.appleId) return s;
    if (s === "youtube" && t.youtubeId) return s;
    if (s === "preview" && t.previewUrl) return s;
  }
  return null;
}

export function ScreenMusic({
  queue,
  active,
  clipSec,
  allowApple = true,
  disabledReason,
  onSource,
  vertical,
}: {
  queue: ScreenTrack[];
  /** Play now (e.g. while voting is open). */
  active: boolean;
  /** Seconds of each song. */
  clipSec: number;
  allowApple?: boolean;
  /** E.g. "Stream-safe mode is on": the deck stays silent and says why. */
  disabledReason?: string | null;
  onSource?: (s: MusicSource) => void;
  vertical?: boolean;
}) {
  const [source, setSource] = useState<MusicSource>("off");
  const [index, setIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const queueKey = queue.map((t) => t.key).join("|");
  const playing = !disabledReason && source !== "off" && active && index >= 0 && index < queue.length ? queue[index]! : null;
  const via = playing ? pick(playing, source) : null;

  const choose = async (s: MusicSource) => {
    setError(null);
    if (s === "apple") {
      try {
        await appleMusic();
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }
    setSource(s);
    onSource?.(s);
    setIndex(active ? 0 : -1);
  };

  // A new round (or the start of voting) plays the queue from the top.
  useEffect(() => {
    setIndex(active ? 0 : -1);
  }, [queueKey, active]);

  // Each song plays for clipSec, then the next; then quiet.
  useEffect(() => {
    if (!playing || !via) {
      audio.current?.pause();
      if (source === "apple") window.MusicKit?.getInstance()?.stop();
      return;
    }
    let cancelled = false;
    const start = startAt(playing, via, clipSec);
    if (via === "preview") {
      const el = audio.current;
      if (el) {
        el.src = playing.previewUrl!;
        el.currentTime = 0;
        void el.play().catch(() => setError("Tap a music button to let this screen play sound."));
      }
    } else if (via === "apple") {
      void appleMusic()
        .then(async (mk) => {
          if (cancelled) return;
          await mk.setQueue({ song: playing.appleId!, startPlaying: true });
          if (start) await mk.seekToTime(start);
        })
        .catch(() => setError("Apple Music couldn't play that one."));
    }
    const t = setTimeout(() => setIndex((i) => i + 1), clipSec * 1000);
    return () => {
      cancelled = true;
      clearTimeout(t);
      audio.current?.pause();
      if (via === "apple") window.MusicKit?.getInstance()?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing?.key, via, clipSec]);

  const btn = (s: MusicSource, label: string) => (
    <button
      type="button"
      onClick={() => void choose(s)}
      aria-pressed={source === s}
      className={`rounded-lg border px-3 py-1 text-sm font-bold ${source === s ? "border-violet bg-violet text-white" : "border-white/20 text-white/80"}`}
    >
      {label}
    </button>
  );

  return (
    <div className={`flex ${vertical ? "flex-col items-stretch" : "flex-wrap items-center"} gap-2 rounded-2xl bg-white/5 px-4 py-3`} data-screen-music>
      <span className="text-sm font-bold uppercase tracking-[0.2em] text-muted">Music on this screen</span>
      {disabledReason ? (
        <span className="text-sm text-muted">{disabledReason}</span>
      ) : (
        <div className="flex flex-wrap gap-2">
          {btn("off", "Off")}
          {btn("youtube", "YouTube")}
          {allowApple ? btn("apple", "Apple Music") : null}
          {btn("preview", "Previews")}
        </div>
      )}
      {playing && via ? (
        <span className="text-sm text-white/80" aria-live="polite">
          ▶ {playing.title} · {playing.artist}
          <span className="text-muted"> ({via === "apple" ? "Apple Music" : via === "youtube" ? "YouTube" : "preview"})</span>
        </span>
      ) : source !== "off" && !disabledReason ? (
        <span className="text-sm text-muted">{active ? "Nothing to play for this pick." : "Plays each pick when voting opens."}</span>
      ) : null}
      {error ? <span className="text-sm text-[#FF6B8A]">{error}</span> : null}
      <audio ref={audio} preload="none" className="hidden" />
      {/* YouTube must be visible to play: a small player in the corner. */}
      {playing && via === "youtube" ? (
        <iframe
          key={playing.key}
          className={vertical ? "aspect-video w-full rounded-lg" : "fixed bottom-6 left-6 z-[60] aspect-video w-72 rounded-lg shadow-2xl"}
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(playing.youtubeId!)}?autoplay=1&rel=0&playsinline=1&start=${startAt(playing, "youtube", clipSec)}&end=${startAt(playing, "youtube", clipSec) + clipSec}`}
          title={`${playing.title} on YouTube`}
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : null}
    </div>
  );
}
