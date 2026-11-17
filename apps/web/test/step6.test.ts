import { type DbHandle, asc, eq, schema } from "@vybz/db";
import { DemoCatalog, YouTubeAdapter } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { importYouTubePlaylist } from "../src/server/imports";
import { TEST_DB_URL, freshDb } from "./helpers";

const video = (id: string, title: string, channel: string) => ({
  id,
  snippet: { title, channelTitle: channel, publishedAt: "2009-10-25T07:00:00Z", description: "Released on: 1999-02-01", thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hq.jpg`, width: 480, height: 360 } } },
  contentDetails: { duration: "PT3M36S" },
  status: { embeddable: true },
});
const VIDEOS: Record<string, ReturnType<typeof video>> = {
  vid_aaaaaa: video("vid_aaaaaa", "TLC - No Scrubs (Official Video)", "TLCVEVO"),
  vid_bbbbbb: video("vid_bbbbbb", "Aaliyah - Are You That Somebody", "Aaliyah - Topic"),
};

/** A YouTube API stand-in: one playlist with two real videos and one removed. */
const ytFetch = async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.pathname.endsWith("/playlists")) return json({ items: url.searchParams.get("id") === "PLslowjams123" ? [{ snippet: { title: "Slow jams" } }] : [] });
  if (url.pathname.endsWith("/playlistItems")) return json({ items: ["vid_aaaaaa", "vid_gone00", "vid_bbbbbb"].map((videoId) => ({ contentDetails: { videoId } })) });
  if (url.pathname.endsWith("/videos")) return json({ items: (url.searchParams.get("id") ?? "").split(",").flatMap((id) => (VIDEOS[id] ? [VIDEOS[id]] : [])) });
  return new Response("not found", { status: 404 });
};

describe.skipIf(!TEST_DB_URL)("step 6", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let me: UserRow;

  beforeAll(async () => {
    h = await freshDb();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    const yt = new YouTubeAdapter({ apiKey: "k", fetch: ytFetch as never });
    deps = { db: h.db, catalog: { metadata: [demo, yt], playback: { VYBZ_DEMO: demo, YOUTUBE: yt }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    [me] = (await h.db.insert(schema.user).values({ id: "u_imp", name: "imp", email: "imp@x.com", handle: "importer" }).returning()) as [UserRow];
  });
  afterAll(() => h?.close());

  it("imports a YouTube playlist in order, skipping videos that are gone", async () => {
    const r = await importYouTubePlaylist(deps, me, { url: "https://music.youtube.com/playlist?list=PLslowjams123&si=abc" });
    expect(r).toMatchObject({ title: "Slow jams", imported: 2, skipped: 1 });
    const rows = await h.db
      .select({ title: schema.track.title, year: schema.track.releaseYear })
      .from(schema.playlistTrack)
      .innerJoin(schema.track, eq(schema.track.id, schema.playlistTrack.trackId))
      .where(eq(schema.playlistTrack.playlistId, r.playlistId))
      .orderBy(asc(schema.playlistTrack.position));
    expect(rows.map((x) => x.title)).toEqual(["No Scrubs", "Are You That Somebody"]);
    expect(rows[0]!.year).toBe(1999);
  });

  it("explains bad links and missing playlists", async () => {
    await expect(importYouTubePlaylist(deps, me, { url: "https://example.com/x" })).rejects.toMatchObject({ code: "INVALID_PLAYLIST_LINK" });
    await expect(importYouTubePlaylist(deps, me, { url: "https://youtube.com/playlist?list=PLnothere1234" })).rejects.toMatchObject({ code: "PLAYLIST_NOT_FOUND" });
    await expect(importYouTubePlaylist({ ...deps, catalog: { ...deps.catalog, metadata: [deps.catalog.metadata[0]!] } }, me, { url: "PLslowjams123" })).rejects.toMatchObject({ code: "IMPORT_UNAVAILABLE" });
    await expect(importYouTubePlaylist(deps, null, { url: "PLslowjams123" })).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
  });
});
