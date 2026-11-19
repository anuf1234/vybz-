import type { WarSide } from "@vybz/core";
import { type Executor, eq, newId, schema } from "@vybz/db";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { viewerKey } from "./live";
import { spotifyLink } from "./spotify";

/**
 * Listening links and outbound plays. The app asks for a link here, which
 * logs the tap (so we can say "VYBZ sent N plays to Spotify") and returns the
 * URL. URLs only ever come from our own records, never from the request, so
 * this can't be used as an open redirect.
 */

export type OutService = "spotify" | "apple" | "youtube" | "source";
export const OUT_SERVICES: readonly OutService[] = ["spotify", "apple", "youtube", "source"];

interface Target {
  title: string;
  artistName: string;
  /** album/EP/mixtape vs a song. */
  type: "album" | "track";
  isrc: string | null;
  /** The provider's own page (Apple Music, or a mixtape's host). */
  sourceUrl: string | null;
  appleUrl: string | null;
}

async function target(db: Executor, kind: string, id: string, side: unknown): Promise<Target | null> {
  if (kind === "release") {
    const [r] = await db.select().from(schema.release).where(eq(schema.release.id, id));
    if (!r || r.status !== "LIVE") return null;
    return {
      title: r.title,
      artistName: r.artistName,
      type: r.kind === "SINGLE" ? "track" : "album",
      isrc: null,
      sourceUrl: r.externalUrl,
      appleUrl: r.provider === "APPLE_MUSIC" ? r.externalUrl : null,
    };
  }
  if (kind === "war") {
    const [w] = await db.select().from(schema.war).where(eq(schema.war.id, id));
    if (!w || (side !== "A" && side !== "B")) return null;
    const s = (side === "A" ? w.a : w.b) as WarSide;
    const apple = s.ref.startsWith("APPLE_MUSIC:") ? s.externalUrl : null;
    return { title: s.title, artistName: s.artistName, type: w.kind === "ALBUM" ? "album" : "track", isrc: null, sourceUrl: s.externalUrl, appleUrl: apple };
  }
  if (kind === "track") {
    const [t] = await db.select().from(schema.track).where(eq(schema.track.id, id));
    if (!t) return null;
    const refs = await db.select().from(schema.trackProviderRef).where(eq(schema.trackProviderRef.trackId, id));
    const apple = refs.find((r) => r.provider === "APPLE_MUSIC")?.externalUrl ?? null;
    const yt = refs.find((r) => r.provider === "YOUTUBE")?.externalUrl ?? null;
    return { title: t.title, artistName: t.artistName, type: "track", isrc: t.isrc, sourceUrl: apple ?? yt, appleUrl: apple };
  }
  return null;
}

const search = (t: Target) => encodeURIComponent(`${t.title} ${t.artistName}`);

/** `{ service, kind: "release" | "war" | "track", id, side? }` → `{ url }`, logging the tap. */
export async function outboundLink(deps: BattleDeps, viewer: UserRow | null, guestKey: string | null, body: unknown): Promise<{ url: string }> {
  const b = (body ?? {}) as { service?: unknown; kind?: unknown; id?: unknown; side?: unknown };
  const service = b.service as OutService;
  if (!OUT_SERVICES.includes(service) || typeof b.kind !== "string" || typeof b.id !== "string") throw new ServiceError(400, "INVALID_REQUEST");
  const t = await target(deps.db, b.kind, b.id, b.side);
  if (!t) throw new ServiceError(404, "NOT_FOUND");
  let url: string | null;
  switch (service) {
    case "spotify":
      url = await spotifyLink(deps.db, t).catch(() => null);
      url ??= `https://open.spotify.com/search/${search(t)}`;
      break;
    case "apple":
      url = t.appleUrl ?? `https://music.apple.com/us/search?term=${search(t)}`;
      break;
    case "youtube":
      url = `https://music.youtube.com/search?q=${search(t)}`;
      break;
    case "source":
      url = t.sourceUrl;
      break;
  }
  if (!url) throw new ServiceError(404, "NO_LINK", "There's no link for that.");
  await deps.db
    .insert(schema.outboundClick)
    .values({ id: newId(), userId: viewer?.id ?? null, viewerKey: viewerKey(viewer, guestKey), service: service === "source" ? sourceService(url) : service, kind: b.kind, ref: `${b.id}${b.side ? `:${b.side}` : ""}` })
    .catch((err) => console.error("outbound log failed", err));
  return { url };
}

/** Which service a provider/mixtape link goes to, for the counts. */
function sourceService(url: string): string {
  const h = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  if (h.endsWith("spotify.com")) return "spotify";
  if (h.endsWith("apple.com")) return "apple";
  if (h.endsWith("youtube.com") || h === "youtu.be") return "youtube";
  return h.split(".").slice(-2, -1)[0] || "other";
}
