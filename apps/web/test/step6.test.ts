import { type DbHandle, asc, eq, schema } from "@vybz/db";
import { DemoCatalog, YouTubeAdapter } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { deleteAccount } from "../src/server/account";
import { importYouTubePlaylist } from "../src/server/imports";
import { liveView, postChat, setChatLike } from "../src/server/live";
import { addComment, createPost, followUser, getPost, openConversation, sendMessage, setCommentLike } from "../src/server/social";
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

  describe("GIFs and likes", () => {
    const GIF = { id: "3o7TKSjRrfIPjeiVyM", url: "https://media2.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif", width: 480, height: 270, title: "Mic drop" };
    let other: UserRow;
    beforeAll(async () => {
      [other] = (await h.db.insert(schema.user).values({ id: "u_oth", name: "oth", email: "oth@x.com", handle: "other" }).returning()) as [UserRow];
    });

    it("takes GIFs only from GIPHY, with or without text", async () => {
      const { id } = await createPost(deps, me, { body: "", gif: GIF });
      await expect(createPost(deps, me, { body: "x", gif: { ...GIF, url: "https://evil.example.com/a.gif" } })).rejects.toMatchObject({ code: "INVALID_GIF" });
      await expect(createPost(deps, me, { body: "" })).rejects.toMatchObject({ code: "INVALID_TEXT" });
      const c = await addComment(deps, other, id, { body: "", gif: GIF });
      expect(c).toMatchObject({ body: "", gif: GIF, likes: 0, liked: false });
      const view = await getPost(deps, me, id, { userId: me.id, storefront: "us", connections: [] });
      expect(view.post.gif).toEqual(GIF);
      expect(view.comments[0]!.gif).toEqual(GIF);
    });

    it("lets people like comments, and tells the author once", async () => {
      // Posted straight to the table to stay clear of the posting rate limits.
      const [p] = await h.db.insert(schema.post).values({ id: "p_rate", authorId: me.id, body: "rate my set" }).returning();
      const id = p!.id;
      const [c] = await h.db.insert(schema.postComment).values({ id: "c_rate", postId: id, authorId: other.id, body: "fire" }).returning();
      expect(await setCommentLike(deps, me, c!.id, true)).toEqual({ likes: 1, liked: true });
      expect(await setCommentLike(deps, me, c!.id, true)).toEqual({ likes: 1, liked: true });
      await setCommentLike(deps, me, c!.id, false);
      await setCommentLike(deps, me, c!.id, true);
      const view = await getPost(deps, me, id, { userId: me.id, storefront: "us", connections: [] });
      expect(view.comments[0]).toMatchObject({ likes: 1, liked: true });
      const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.type, "COMMENT_LIKED"));
      expect(notes.filter((n) => n.userId === other.id)).toHaveLength(1);
    });

    it("puts GIFs and likes in battle chat", async () => {
      const [b] = await h.db.insert(schema.battle).values({ id: "b_chat", status: "IN_PROGRESS", title: "Chat test", rules: { roundCount: 3 }, roundCount: 3, creatorId: me.id }).returning();
      const m = await postChat(deps, other, b!.id, "", [], GIF);
      expect(m.gif).toEqual(GIF);
      expect(await setChatLike(deps, me, b!.id, m.id, true)).toEqual({ likes: 1, liked: true });
      const live = await liveView(deps, me, b!.id, null);
      expect(live.messages[0]).toMatchObject({ gif: GIF, likes: 1, liked: true });
    });

    it("sends GIFs in direct messages", async () => {
      await followUser(deps, me, "other");
      const { id } = await openConversation(deps, me, "other");
      const msg = await sendMessage(deps, me, id, { body: "", gif: GIF });
      expect(msg.gif).toEqual(GIF);
    });
  });

  describe("deleting an account", () => {
    it("removes sign-ins and content and leaves an anonymous row", async () => {
      const [gone] = (await h.db.insert(schema.user).values({ id: "u_gone", name: "Gone", email: "gone@x.com", handle: "goner" }).returning()) as [UserRow];
      await createPost(deps, gone, { body: "bye" });
      await expect(deleteAccount(h.db, gone, {})).rejects.toMatchObject({ code: "CONFIRM_REQUIRED" });
      await deleteAccount(h.db, gone, { confirm: "DELETE" });
      const [row] = await h.db.select().from(schema.user).where(eq(schema.user.id, gone.id));
      expect(row).toMatchObject({ name: "Deleted user", status: "DELETED", image: null });
      expect(row!.email).not.toBe("gone@x.com");
      expect(await h.db.select().from(schema.post).where(eq(schema.post.authorId, gone.id))).toEqual([]);
    });
  });
});
