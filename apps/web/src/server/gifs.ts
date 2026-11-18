import type { GifView } from "@vybz/core";
import { ServiceError } from "./battles/service";

/**
 * GIFs come from GIPHY: the app searches GIPHY directly (GIPHY's rule) and
 * sends us the one picked. We only accept GIPHY media URLs, so a "GIF" can't
 * be used to put arbitrary links or images in front of people.
 */

const HOST = /^(media\d*\.giphy\.com|i\.giphy\.com)$/;

export function parseGif(raw: unknown): GifView | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") throw bad();
  const g = raw as Record<string, unknown>;
  const id = typeof g.id === "string" && /^[A-Za-z0-9]{3,40}$/.test(g.id) ? g.id : null;
  const width = typeof g.width === "number" && Number.isInteger(g.width) && g.width > 0 && g.width <= 4000 ? g.width : null;
  const height = typeof g.height === "number" && Number.isInteger(g.height) && g.height > 0 && g.height <= 4000 ? g.height : null;
  const title = typeof g.title === "string" ? g.title.trim().slice(0, 140) : "";
  let url: string | null = null;
  try {
    const u = new URL(String(g.url));
    if (u.protocol === "https:" && HOST.test(u.hostname) && /\.(gif|webp)$/.test(u.pathname)) url = u.toString();
  } catch {
    url = null;
  }
  if (!id || !url || !width || !height) throw bad();
  return { id, url, width, height, title };
}

/** Reads a stored jsonb gif back; anything malformed is dropped rather than shown. */
export function storedGif(raw: unknown): GifView | null {
  try {
    return parseGif(raw);
  } catch {
    return null;
  }
}

function bad() {
  return new ServiceError(400, "INVALID_GIF", "That GIF couldn't be used.");
}
