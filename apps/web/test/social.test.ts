import { type DbHandle, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BattleDeps, type UserRow, profile } from "../src/server/battles/service";
import { viewerContext } from "../src/server/catalog";
import { createPlaylist } from "../src/server/library";
import { fileReport, listReports, resolveReport } from "../src/server/moderation";
import { type PushMessage, listNotifications, savePushToken } from "../src/server/notifications";
import {
  addComment,
  blockUser,
  createPost,
  deleteComment,
  deletePost,
  feed,
  followList,
  followUser,
  getConversation,
  getPost,
  inbox,
  openConversation,
  peopleSuggestions,
  sendMessage,
  setLike,
  unblockUser,
  unfollowUser,
} from "../src/server/social";
import { TEST_DB_URL, freshDb } from "./helpers";

describe.skipIf(!TEST_DB_URL)("social: follows, posts, comments, messages", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  const pushes: PushMessage[] = [];
  const u: Record<string, UserRow> = {};
  const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
  const ctx = viewerContext("us");

  beforeAll(async () => {
    h = await freshDb();
    deps = {
      db: h.db,
      catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" },
      requireVerifiedEmail: false,
      aiJudge: null,
      push: async (m) => void pushes.push(...m),
    };
    for (const handle of ["amy", "bob", "cal", "mod"]) {
      const [row] = await h.db
        .insert(schema.user)
        .values({ id: `u_${handle}`, name: handle, email: `${handle}@x.com`, handle, role: handle === "mod" ? "MODERATOR" : "USER" })
        .returning();
      u[handle] = row!;
    }
    await savePushToken(h.db, u.amy!.id, "ExponentPushToken[amy-phone-1]", "ios");
  });
  afterAll(() => h?.close());

  const err = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? String(e));
  // Rate limits look at recent rows; age them so the next action is allowed.
  const age = async () => {
    const past = new Date(Date.now() - 3600_000);
    await h.db.update(schema.post).set({ createdAt: past });
    await h.db.update(schema.postComment).set({ createdAt: past });
    await h.db.update(schema.directMessage).set({ createdAt: past });
  };

  it("follows and unfollows, with counts, lists and a notification", async () => {
    await followUser(deps, u.amy!, "bob");
    await followUser(deps, u.amy!, "bob"); // twice is fine
    await followUser(deps, u.cal!, "bob");
    expect(await err(followUser(deps, u.amy!, "amy"))).toBe("INVALID_REQUEST");
    const p = await profile(deps, u.amy!, "bob");
    expect(p.social).toMatchObject({ followers: 2, following: 0, viewer: { follows: true, followedBy: false, blocked: false, canMessage: true } });
    expect((await followList(deps, u.amy!, "bob", "followers")).items.map((x) => x.handle).sort()).toEqual(["amy", "cal"]);
    const n = await listNotifications(h.db, u.bob!.id);
    expect(n.items.filter((x) => x.type === "NEW_FOLLOWER")).toHaveLength(2);
    expect(n.items[0]!.link).toMatch(/^\/user\//);
    await unfollowUser(deps, u.cal!, "bob");
    expect((await profile(deps, null, "bob")).social.followers).toBe(1);
  });

  it("suggests people: followers you don't follow back first", async () => {
    const s = await peopleSuggestions(deps, u.bob!);
    expect(s.items[0]).toMatchObject({ handle: "amy", reason: "Follows you" });
    expect(s.items.map((x) => x.handle)).not.toContain("bob");
  });

  let postId = "";

  it("posts with an attachment show in followers' feeds and the public feed", async () => {
    ({ id: postId } = await createPost(deps, u.bob!, { body: "  This one never misses.  ", catalogId: "VYBZ_DEMO:velvet-circuit" }));
    expect(await err(createPost(deps, u.bob!, { body: "too fast" }))).toBe("SLOW_DOWN");
    await age();
    expect(await err(createPost(deps, u.bob!, { body: "" }))).toBe("INVALID_TEXT");
    expect(await err(createPost(deps, u.bob!, { body: "two", trackId: "x", battleId: "y" }))).toBe("INVALID_REQUEST");
    const { id: plId } = await createPlaylist(deps, u.bob!, { title: "Private" }, ctx);
    expect(await err(createPost(deps, u.bob!, { body: "my list", playlistId: plId }))).toBe("PLAYLIST_NOT_PUBLIC");

    const amyFeed = await feed(deps, u.amy!, { kind: "following" }, null, ctx);
    expect(amyFeed.items[0]).toMatchObject({ id: postId, body: "This one never misses.", attachment: { kind: "track", track: expect.objectContaining({ title: "Velvet Circuit" }) } });
    expect((await feed(deps, u.cal!, { kind: "following" }, null, ctx)).items).toHaveLength(0);
    expect((await feed(deps, null, { kind: "for_you" }, null, ctx)).items.map((p) => p.id)).toContain(postId);
    expect((await feed(deps, null, { kind: "user", handle: "bob" }, null, ctx)).items).toHaveLength(1);
  });

  it("pages older posts with a cursor", async () => {
    for (let i = 0; i < 3; i++) {
      await createPost(deps, u.cal!, { body: `post ${i}` });
      await age();
    }
    const first = await feed(deps, null, { kind: "for_you" }, null, ctx, 2);
    expect(first.items).toHaveLength(2);
    const second = await feed(deps, null, { kind: "for_you" }, first.nextCursor, ctx, 2);
    expect(second.items.map((p) => p.id)).not.toContain(first.items[0]!.id);
    expect([...first.items, ...second.items].map((p) => p.id).length).toBe(4);
  });

  it("likes notify once; comments notify and can be deleted by the post's author", async () => {
    await setLike(deps, u.amy!, postId, true);
    await setLike(deps, u.amy!, postId, false);
    await setLike(deps, u.amy!, postId, true);
    const detail = await getPost(deps, u.amy!, postId, ctx);
    expect(detail.post).toMatchObject({ likes: 1, viewer: { liked: true, canDelete: false } });
    expect((await listNotifications(h.db, u.bob!.id)).items.filter((x) => x.type === "POST_LIKED")).toHaveLength(1);

    const c = await addComment(deps, u.amy!, postId, { body: "facts" });
    expect(await err(addComment(deps, u.amy!, postId, { body: "again" }))).toBe("SLOW_DOWN");
    expect((await getPost(deps, null, postId, ctx)).comments.map((x) => x.body)).toEqual(["facts"]);
    expect((await listNotifications(h.db, u.bob!.id)).items[0]).toMatchObject({ type: "POST_COMMENT", link: `/post/${postId}` });
    expect(await err(deleteComment(deps, u.cal!, c.id))).toBe("FORBIDDEN");
    await deleteComment(deps, u.bob!, c.id);
    expect((await getPost(deps, null, postId, ctx)).post.comments).toBe(0);
  });

  let convId = "";

  it("messages need a follow either way; notify on a new unread stretch; mark read", async () => {
    expect(await err(openConversation(deps, u.cal!, "amy"))).toBe("NOT_CONNECTED");
    ({ id: convId } = await openConversation(deps, u.bob!, "amy")); // amy follows bob
    expect((await openConversation(deps, u.amy!, "bob")).id).toBe(convId);
    await sendMessage(deps, u.bob!, convId, { body: "yo" });
    await age();
    await sendMessage(deps, u.bob!, convId, { body: "you there?" });
    const box = await inbox(deps, u.amy!);
    expect(box).toMatchObject({ unread: 1, items: [{ id: convId, unread: true, lastMessage: { body: "you there?", fromMe: false } }] });
    // Only the first of the two unread messages notified.
    expect((await listNotifications(h.db, u.amy!.id)).items.filter((x) => x.type === "NEW_MESSAGE")).toHaveLength(1);
    const view = await getConversation(deps, u.amy!, convId);
    expect(view.messages.map((m) => m.body)).toEqual(["yo", "you there?"]);
    expect(view.canSend).toBe(true);
    expect((await inbox(deps, u.amy!)).unread).toBe(0);
    expect(await err(getConversation(deps, u.cal!, convId))).toBe("NOT_FOUND");
    expect(pushes.some((p) => (p.data as { link?: string } | undefined)?.link === `/messages/${convId}`)).toBe(true);
  });

  it("blocking hides people from each other and stops follows and messages", async () => {
    await blockUser(deps, u.amy!, "bob");
    expect((await profile(deps, u.amy!, "bob")).social.viewer).toMatchObject({ follows: false, blocked: true, canMessage: false });
    expect((await feed(deps, u.amy!, { kind: "for_you" }, null, ctx)).items.map((p) => p.author.handle)).not.toContain("bob");
    expect(await err(getPost(deps, u.amy!, postId, ctx))).toBe("NOT_FOUND");
    expect(await err(followUser(deps, u.bob!, "amy"))).toBe("BLOCKED");
    expect(await err(sendMessage(deps, u.bob!, convId, { body: "hello?" }))).toBe("BLOCKED");
    expect((await getConversation(deps, u.bob!, convId)).blockedReason).toBe("BLOCKED");
    expect((await inbox(deps, u.amy!)).items).toHaveLength(0);
    await unblockUser(deps, u.amy!, "bob");
    expect((await profile(deps, u.amy!, "bob")).social.viewer?.blocked).toBe(false);
  });

  it("reported posts reach the moderation queue and can be hidden", async () => {
    await fileReport(deps, u.cal!, { subjectType: "POST", subjectId: postId, reason: "spam spam" });
    const [r] = await listReports(deps, u.mod!);
    expect(r).toMatchObject({ subjectType: "POST", context: { text: "This one never misses.", user: expect.objectContaining({ handle: "bob" }), postId } });
    await resolveReport(deps, u.mod!, r!.id, { action: "HIDE_MESSAGE" });
    expect(await err(getPost(deps, u.amy!, postId, ctx))).toBe("NOT_FOUND");
    expect((await feed(deps, null, { kind: "user", handle: "bob" }, null, ctx)).items).toHaveLength(0);
    // A direct message can be reported only by someone in the conversation.
    const [m] = await h.db.select().from(schema.directMessage).where(eq(schema.directMessage.conversationId, convId));
    expect(await err(fileReport(deps, u.cal!, { subjectType: "DIRECT_MESSAGE", subjectId: m!.id, reason: "not mine" }))).toBe("NOT_FOUND");
    await fileReport(deps, u.amy!, { subjectType: "DIRECT_MESSAGE", subjectId: m!.id, reason: "rude rude" });
  });

  it("authors and moderators can delete posts", async () => {
    await age();
    const { id } = await createPost(deps, u.cal!, { body: "delete me" });
    expect(await err(deletePost(deps, u.amy!, id))).toBe("FORBIDDEN");
    await deletePost(deps, u.mod!, id);
    expect(await err(getPost(deps, null, id, ctx))).toBe("NOT_FOUND");
  });
});
