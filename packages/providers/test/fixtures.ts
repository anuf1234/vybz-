import type { FetchLike } from "../src/types";

/** A fetch stub that answers by URL path and records every request. */
export function stubFetch(routes: Record<string, unknown | ((url: URL) => unknown)>, status = 200) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fn: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    const route = Object.entries(routes).find(([path]) => url.pathname.endsWith(path));
    if (!route) return new Response("not found", { status: 404 });
    const body = typeof route[1] === "function" ? (route[1] as (u: URL) => unknown)(url) : route[1];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fn, calls };
}

export const appleSong = {
  id: "1440833098",
  type: "songs",
  attributes: {
    name: "No Scrubs",
    artistName: "TLC",
    albumName: "FanMail",
    durationInMillis: 214_000,
    isrc: "USLF29900128",
    releaseDate: "1999-02-01",
    genreNames: ["R&B/Soul", "Music"],
    contentRating: "clean",
    url: "https://music.apple.com/us/album/no-scrubs/1440832903?i=1440833098",
    artwork: { url: "https://is1-ssl.mzstatic.com/image/thumb/x/{w}x{h}bb.jpg", width: 3000, height: 3000 },
    previews: [{ url: "https://audio-ssl.itunes.apple.com/preview.m4a" }],
    playParams: { id: "1440833098", kind: "song" },
  },
};

export const youtubeVideo = (over: Partial<{ id: string; title: string; channel: string; duration: string; embeddable: boolean }> = {}) => ({
  id: over.id ?? "FrLequ6dUdM",
  snippet: {
    title: over.title ?? "TLC - No Scrubs (Official Video)",
    channelTitle: over.channel ?? "TLCVEVO",
    publishedAt: "2009-10-25T07:00:00Z",
    thumbnails: { high: { url: "https://i.ytimg.com/vi/FrLequ6dUdM/hqdefault.jpg", width: 480, height: 360 } },
  },
  contentDetails: { duration: over.duration ?? "PT3M36S" },
  status: { embeddable: over.embeddable ?? true },
});
