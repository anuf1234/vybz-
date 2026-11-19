import { type Executor, and, eq, schema } from "@vybz/db";
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

// ── Saving playlists to someone's Spotify ──────────────────────────────────

/** A linked Spotify account's access token, refreshed if it's about to expire. Null when not linked. */
export async function userSpotifyToken(db: Executor, userId: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const env = serverEnv();
  const [acct] = await db
    .select()
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "spotify")));
  if (!acct?.accessToken) return null;
  if (acct.accessTokenExpiresAt && acct.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return acct.accessToken;
  if (!acct.refreshToken || !env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;
  const res = await fetchFn(ACCOUNTS, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: acct.refreshToken }).toString(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
  await db
    .update(schema.account)
    .set({ accessToken: json.access_token, accessTokenExpiresAt: new Date(Date.now() + json.expires_in * 1000), ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}) })
    .where(eq(schema.account.id, acct.id));
  return json.access_token;
}

async function api<T>(fetchFn: typeof fetch, tokenValue: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchFn(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${tokenValue}`, "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`spotify ${path.split("?")[0]} ${res.status}`);
  return (await res.json()) as T;
}

/** A song for each item (a single's own song, an album's first track), found with the user's token. */
async function songUris(fetchFn: typeof fetch, t: string, items: SpotifyQuery[]): Promise<string[]> {
  const out: string[] = [];
  for (const q of items) {
    try {
      const params = new URLSearchParams({ q: spotifyQuery(q), type: q.type, limit: "5" });
      const json = await api<{
        albums?: { items: { id: string; name: string; artists: { name: string }[] }[] };
        tracks?: { items: { uri: string; name: string; artists: { name: string }[] }[] };
      }>(fetchFn, t, `/search?${params}`);
      const match = <X extends { name: string; artists: { name: string }[] }>(xs: X[]) => xs.find((i) => norm(i.name) === norm(q.title) && i.artists.some((a) => norm(a.name) === norm(q.artistName))) ?? xs.find((i) => i.artists.some((a) => norm(a.name) === norm(q.artistName)));
      if (q.type === "track") {
        const hit = match(json.tracks?.items ?? []);
        if (hit) out.push(hit.uri);
      } else {
        const album = match(json.albums?.items ?? []);
        if (!album) continue;
        const tracks = await api<{ items: { uri: string }[] }>(fetchFn, t, `/albums/${album.id}/tracks?limit=1`);
        if (tracks.items[0]) out.push(tracks.items[0].uri);
      }
    } catch (err) {
      console.warn("spotify lookup failed", q.title, err);
    }
  }
  return [...new Set(out)];
}

/** Creates a private playlist on the user's Spotify. Returns its URL and how many songs made it. */
export async function createSpotifyPlaylist(
  db: Executor,
  userId: string,
  name: string,
  description: string,
  items: SpotifyQuery[],
  fetchFn: typeof fetch = fetch,
): Promise<{ url: string; added: number } | "NOT_LINKED"> {
  const t = await userSpotifyToken(db, userId, fetchFn);
  if (!t) return "NOT_LINKED";
  const uris = await songUris(fetchFn, t, items);
  const me = await api<{ id: string }>(fetchFn, t, "/me");
  const pl = await api<{ id: string; external_urls: { spotify: string } }>(fetchFn, t, `/users/${encodeURIComponent(me.id)}/playlists`, {
    method: "POST",
    body: JSON.stringify({ name: name.slice(0, 100), description: description.slice(0, 300), public: false }),
  });
  if (uris.length) await api(fetchFn, t, `/playlists/${pl.id}/tracks`, { method: "POST", body: JSON.stringify({ uris: uris.slice(0, 100) }) });
  return { url: pl.external_urls.spotify, added: uris.length };
}
