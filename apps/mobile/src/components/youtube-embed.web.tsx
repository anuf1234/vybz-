import { useEffect, useRef } from "react";
import { View } from "react-native";
import type { YouTubeEmbedProps } from "./youtube-embed";

/* Web build: the same visible YouTube player, via the IFrame API in the page. */

type YTPlayer = { pauseVideo: () => void; destroy: () => void };
type YTNamespace = { Player: new (el: HTMLElement, opts: unknown) => YTPlayer };
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  apiReady ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiReady;
}

export function YouTubeEmbed({ videoId, active, onPlayingChange }: YouTubeEmbedProps) {
  const host = useRef<unknown>(null);
  const player = useRef<YTPlayer | null>(null);
  const cb = useRef(onPlayingChange);
  cb.current = onPlayingChange;

  useEffect(() => {
    let cancelled = false;
    const el = document.createElement("div");
    (host.current as unknown as HTMLElement).appendChild(el);
    void loadApi().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(el, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: { onStateChange: (e: { data: number }) => cb.current(e.data === 1) },
      });
    });
    return () => {
      cancelled = true;
      player.current?.destroy();
      el.remove();
    };
  }, [videoId]);

  useEffect(() => {
    if (!active) player.current?.pauseVideo();
  }, [active]);

  return <View ref={host as never} style={{ aspectRatio: 16 / 9, width: "100%", borderRadius: 10, overflow: "hidden", backgroundColor: "#000" }} />;
}
