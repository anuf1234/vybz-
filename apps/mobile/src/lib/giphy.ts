import type { GifView } from "@vybz/core";

/**
 * GIPHY search, made from the app as GIPHY requires. The key comes from the
 * server's /config so it can change without an app update.
 */

interface GiphyImage {
  url: string;
  width: string;
  height: string;
}
interface GiphyGif {
  id: string;
  title: string;
  images: { fixed_height?: GiphyImage; fixed_width_small?: GiphyImage; downsized?: GiphyImage };
}

export interface GifResult extends GifView {
  /** A smaller rendition for the picker grid. */
  previewUrl: string;
}

function toResult(g: GiphyGif): GifResult | null {
  const full = g.images.fixed_height ?? g.images.downsized;
  const small = g.images.fixed_width_small ?? full;
  if (!full || !small) return null;
  // Keep the URL clean (GIPHY adds tracking query strings) and on https.
  const clean = (u: string) => u.split("?")[0]!.replace(/^http:/, "https:");
  return { id: g.id, title: g.title ?? "", url: clean(full.url), width: Number(full.width) || 200, height: Number(full.height) || 200, previewUrl: clean(small.url) };
}

export async function searchGifs(apiKey: string, query: string, offset = 0): Promise<GifResult[]> {
  const q = query.trim();
  const params = new URLSearchParams({ api_key: apiKey, limit: "24", offset: String(offset), rating: "pg-13", bundle: "messaging_non_clips" });
  if (q) params.set("q", q);
  const res = await fetch(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}?${params}`);
  if (!res.ok) throw new Error(res.status === 429 ? "GIF search is busy. Try again in a bit." : "Couldn't load GIFs.");
  const json = (await res.json()) as { data: GiphyGif[] };
  return json.data.map(toResult).filter((g): g is GifResult => g !== null);
}

/** The part of a result we store on a message. */
export function toGif(r: GifResult): GifView {
  return { id: r.id, url: r.url, width: r.width, height: r.height, title: r.title };
}
