import { type DbHandle, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BattleDeps, type UserRow, acceptBattle, createBattle, getBattleView, submitPick } from "../src/server/battles/service";
import { viewerContext } from "../src/server/catalog";
import {
  addCollaborator,
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listLibrary,
  listPlaylists,
  removeCollaborator,
  removeFromLibrary,
  removeFromPlaylist,
  reorderPlaylist,
  saveToLibrary,
  updatePlaylist,
} from "../src/server/library";
import { TEST_DB_URL, freshDb } from "./helpers";

describe.skipIf(!TEST_DB_URL)("library and playlists", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  const u: Record<string, UserRow> = {};
  const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
  const viewer = viewerContext("us");

  beforeAll(async () => {
    h = await freshDb();
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    for (const handle of ["owner", "friend", "stranger"]) {
      const [row] = await h.db.insert(schema.user).values({ id: `u_${handle}`, name: handle, email: `${handle}@x.com`, handle }).returning();
      u[handle] = row!;
    }
  });
  afterAll(() => h?.close());

  const err = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; status?: number }) => e.code ?? String(e));

  it("saves songs, lists them newest first, and removes them", async () => {
    expect(await err(listLibrary(deps, null, viewer))).toBe("SIGN_IN_REQUIRED");
    const a = await saveToLibrary(deps, u.owner!, { catalogId: "VYBZ_DEMO:neon-hallway" });
    await saveToLibrary(deps, u.owner!, { catalogId: "VYBZ_DEMO:pulse-garden" });
    // Saving twice is harmless; saving by track id works too.
    await saveToLibrary(deps, u.owner!, { trackId: a.trackId });
    const lib = await listLibrary(deps, u.owner!, viewer);
    expect(lib.items.map((i) => i.title)).toEqual(["Pulse Garden", "Neon Hallway"]);
    expect(lib.items[0]).toMatchObject({ catalogId: "VYBZ_DEMO:pulse-garden", sources: [expect.objectContaining({ tier: "HOSTED_FULL" })] });
    await removeFromLibrary(deps, u.owner!, a.trackId);
    expect((await listLibrary(deps, u.owner!, viewer)).trackIds).toHaveLength(1);
    expect(await err(saveToLibrary(deps, u.owner!, { catalogId: "VYBZ_DEMO:nope" }))).toBe("TRACK_NOT_FOUND");
    expect(await err(saveToLibrary(deps, u.owner!, {}))).toBe("INVALID_REQUEST");
  });

  let pid = "";

  it("creates a private playlist only its people can see; the share code opens it", async () => {
    ({ id: pid } = await createPlaylist(deps, u.owner!, { title: "Late night" }, viewer));
    await addToPlaylist(deps, u.owner!, pid, { catalogId: "VYBZ_DEMO:neon-hallway" });
    await addToPlaylist(deps, u.owner!, pid, { catalogId: "VYBZ_DEMO:midnight-static" });
    await addToPlaylist(deps, u.owner!, pid, { catalogId: "VYBZ_DEMO:velvet-circuit" });
    expect(await err(addToPlaylist(deps, u.owner!, pid, { catalogId: "VYBZ_DEMO:velvet-circuit" }))).toBe("ALREADY_IN_PLAYLIST");

    const mine = await getPlaylist(deps, u.owner!, pid, null, viewer);
    expect(mine.tracks.map((t) => t.title)).toEqual(["Neon Hallway", "Midnight Static", "Velvet Circuit"]);
    expect(mine.viewer).toEqual({ isOwner: true, canEdit: true });
    expect(mine.trackCount).toBe(3);
    expect(mine.visibility).toBe("PRIVATE");

    expect(await err(getPlaylist(deps, u.stranger!, pid, null, viewer))).toBe("NOT_FOUND");
    const viaLink = await getPlaylist(deps, u.stranger!, pid, mine.shareCode, viewer);
    expect(viaLink.viewer.canEdit).toBe(false);
    expect(viaLink.shareCode).toBeNull();
    expect(await err(addToPlaylist(deps, u.stranger!, pid, { catalogId: "VYBZ_DEMO:glass-parade" }))).toBe("NOT_FOUND");
  });

  it("lets collaborators add, remove and reorder, but only the owner manages the playlist", async () => {
    await addCollaborator(deps, u.owner!, pid, { handle: "@friend" });
    expect(await err(addCollaborator(deps, u.owner!, pid, { handle: "nobody" }))).toBe("OPPONENT_NOT_FOUND");
    const added = await addToPlaylist(deps, u.friend!, pid, { catalogId: "VYBZ_DEMO:glass-parade" });
    const view = await getPlaylist(deps, u.friend!, pid, null, viewer);
    expect(view.viewer).toEqual({ isOwner: false, canEdit: true });
    expect(view.tracks.at(-1)).toMatchObject({ title: "Glass Parade", addedBy: expect.objectContaining({ handle: "friend" }) });
    expect(view.collaborators.map((c) => c.handle)).toEqual(["friend"]);

    const order = [...view.tracks.map((t) => t.trackId)].reverse();
    await reorderPlaylist(deps, u.friend!, pid, { trackIds: order });
    expect((await getPlaylist(deps, u.owner!, pid, null, viewer)).tracks.map((t) => t.title)).toEqual(["Glass Parade", "Velvet Circuit", "Midnight Static", "Neon Hallway"]);
    expect(await err(reorderPlaylist(deps, u.friend!, pid, { trackIds: order.slice(1) }))).toBe("ORDER_MISMATCH");

    await removeFromPlaylist(deps, u.friend!, pid, added.trackId);
    expect(await err(updatePlaylist(deps, u.friend!, pid, { title: "Mine now" }))).toBe("NOT_OWNER");
    expect(await err(deletePlaylist(deps, u.friend!, pid))).toBe("NOT_OWNER");

    // Shows up under "mine" for both.
    expect((await listPlaylists(deps, u.friend!, { kind: "mine" })).items.map((p) => p.id)).toContain(pid);
    // A collaborator can leave.
    await removeCollaborator(deps, u.friend!, pid, u.friend!.id);
    expect((await listPlaylists(deps, u.friend!, { kind: "mine" })).items).toHaveLength(0);
  });

  it("goes public, renames, and appears in public lists with a cover mosaic", async () => {
    await updatePlaylist(deps, u.owner!, pid, { visibility: "PUBLIC", title: "Late night drive", description: "Windows down." });
    const pub = await listPlaylists(deps, null, { kind: "public" });
    expect(pub.items[0]).toMatchObject({ id: pid, title: "Late night drive", description: "Windows down.", trackCount: 3, owner: expect.objectContaining({ handle: "owner" }) });
    expect(pub.items[0]!.artworkUrls.length).toBeGreaterThan(0);
    expect((await getPlaylist(deps, null, pid, null, viewer)).tracks).toHaveLength(3);
    expect((await listPlaylists(deps, null, { kind: "user", userId: u.owner!.id })).items).toHaveLength(1);
  });

  it("generates a playlist from a genre and era", async () => {
    const { id } = await createPlaylist(deps, u.owner!, { title: "2000s R&B", generate: { genres: ["rnb"], eraFrom: 2000, eraTo: 2009, size: 10 } }, viewer);
    const p = await getPlaylist(deps, u.owner!, id, null, viewer);
    expect(p.tracks.map((t) => t.title).sort()).toEqual(["Low Tide Signal", "Midnight Static", "Neon Hallway", "Velvet Circuit"]);
    expect(p).toMatchObject({ genres: ["rnb"], eraFrom: 2000, eraTo: 2009 });
    expect(await err(createPlaylist(deps, u.owner!, { title: "x", generate: { genres: ["polka"] } }, viewer))).toBe("INVALID_REQUEST");
  });

  it("songs from a playlist can be picked in a battle", async () => {
    const p = await getPlaylist(deps, u.owner!, pid, null, viewer);
    const { id } = await createBattle(deps, u.owner!, { title: "From my playlist", opponentHandle: "friend", rules: { roundCount: 3, fairListen: { minPlayedMs: 0 } } });
    await acceptBattle(deps, u.friend!, id);
    await submitPick(deps, u.owner!, id, 0, { catalogIds: [p.tracks[0]!.catalogId] });
    const view = await getBattleView(deps, u.owner!, id);
    expect(view.rounds[0]!.viewer.mySubmission?.tracks[0]?.title).toBe(p.tracks[0]!.title);
  });

  it("deletes a playlist", async () => {
    await deletePlaylist(deps, u.owner!, pid);
    expect(await err(getPlaylist(deps, u.owner!, pid, null, viewer))).toBe("NOT_FOUND");
  });
});
