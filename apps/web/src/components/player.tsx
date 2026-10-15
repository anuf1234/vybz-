"use client";

import type { PlaybackSource } from "@vybz/providers";
import { useEffect, useRef } from "react";

/**
 * Renders a resolved playback source exactly as the provider allows:
 *  - YouTube: the visible IFrame player (no audio-only playback).
 *  - Apple Music preview: plain <audio>, stopped at the preview limit.
 *  - Always shows provider attribution with a link back.
 * Full Apple Music playback via MusicKit JS lands with account connections.
 */
export function Player({ source, title }: { source: PlaybackSource; title: string }) {
  return (
    <div className="mt-3 space-y-2">
      {source.tier === "EMBED" && (
        <div className="aspect-video overflow-hidden rounded-lg bg-black">
          <iframe
            className="size-full"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(source.embed.videoId)}?autoplay=1&rel=0&playsinline=1`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      )}
      {source.tier === "PREVIEW" && <PreviewAudio src={source.url} maxMs={source.restrictions.maxPlayMs} title={title} />}
      {source.attribution.href && (
        <a
          href={source.attribution.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs text-muted hover:text-text"
        >
          {source.tier === "PREVIEW" ? "Preview from" : "Open in"} {source.attribution.label} ↗
        </a>
      )}
    </div>
  );
}

function PreviewAudio({ src, maxMs, title }: { src: string; maxMs: number | undefined; title: string }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !maxMs) return;
    const stopAtLimit = () => {
      if (el.currentTime * 1000 >= maxMs) el.pause();
    };
    el.addEventListener("timeupdate", stopAtLimit);
    return () => el.removeEventListener("timeupdate", stopAtLimit);
  }, [maxMs]);

  return <audio ref={ref} src={src} controls autoPlay className="w-full" aria-label={`Preview of ${title}`} />;
}
