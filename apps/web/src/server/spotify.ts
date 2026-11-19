import { type Executor, eq, schema } from "@vybz/db";
import { serverEnv } from "./env";

/**
 * Spotify Web API, app-level (client credentials): finds a release's or a
 * song's own Spotify page so "Spotify" opens the exact thing instead of a
 * search. Off unless SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set.
 * Results (including "not found") are cached in link_cache.
 */

const ACCOUNTS = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

let token: { value: string; expiresAt: number } | null = null;

export function spotifyConfigured(): boolean {
  const env = serverEnv();
  return !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

async function appToken(fetchFn: typeof fetch = fetch): Promise<string | null> {
  const env = serverEnv();
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const res = await fetchFn(ACCOUNTS, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64")}` },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`spotify token ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

const clean = (s: string) => s.replace(/["\\]/g, "").replace(/\s*[([].*?(feat|with|deluxe|remaster).*?[)\]]/gi, "").trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export interface SpotifyQuery {
  title: string;
  artistName: string;
  type: "album" | "track";
  isrc: string | null;
}

/** The Spotify search query for a release or song. */
export function spotifyQuery(q: SpotifyQuery): string {
  if (q.type === "track" && q.isrc) return `isrc:${q.isrc}`;
  return `${q.type}:"${clean(q.title)}" artist:"${clean(q.artistName)}"`;
}

/** Exact open.spotify.com URL, or null (not configured, or not on Spotify). */
export async function spotifyLink(db: Executor, q: SpotifyQuery, fetchFn: typeof fetch = fetch): Promise<string | null> {
  if (!spotifyConfigured()) return null;
  const key = `spotify:${q.type}:${q.isrc ?? `${norm(q.title)}|${norm(q.artistName)}`}`;
  const [hit] = await db.select().from(schema.linkCache).where(eq(schema.linkCache.key, key));
  if (hit) return hit.url;
  const t = await appToken(fetchFn);
  if (!t) return null;
  const params = new URLSearchParams({ q: spotifyQuery(q), type: q.type, limit: "5" });
  const res = await fetchFn(`${API}/search?${params}`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`spotify search ${res.status}`);
  const json = (await res.json()) as {
    albums?: { items: { name: string; artists: { name: string }[]; external_urls: { spotify?: string } }[] };
    tracks?: { items: { name: string; artists: { name: string }[]; external_urls: { spotify?: string } }[] };
  };
  const items = (q.type === "album" ? json.albums?.items : json.tracks?.items) ?? [];
  // Prefer an exact title + artist match; ISRC matches are exact already.
  const best = items.find((i) => norm(i.name) === norm(q.title) && i.artists.some((a) => norm(a.name) === norm(q.artistName))) ?? (q.isrc ? items[0] : undefined);
  const url = best?.external_urls.spotify ?? null;
  await db.insert(schema.linkCache).values({ key, url }).onConflictDoNothing();
  return url;
}

/** For tests. */
export function forgetSpotifyToken(): void {
  token = null;
}
