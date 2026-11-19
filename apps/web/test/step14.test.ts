import { type DbHandle, eq, schema } from "@vybz/db";
import { DemoCatalog } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artistPage, challengeArtist, claimArtistProfile, myArtistProfile, pendingArtistProfiles, reviewArtistProfile } from "../src/server/artists";
import type { BattleDeps, UserRow } from "../src/server/battles/service";
import { profile } from "../src/server/battles/service";
import { forgetBot } from "../src/server/bot";
import { followArtist, listDrops, runDailyDrops } from "../src/server/drops";
import { TEST_DB_URL, freshDb } from "./helpers";

describe.skipIf(!TEST_DB_URL)("artist profiles and challenges", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  let kaia: UserRow;
  let fan: UserRow;
  let mod: UserRow;
  let imposter: UserRow;

  beforeAll(async () => {
    h = await freshDb();
    forgetBot();
    const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
    deps = { db: h.db, catalog: { metadata: [demo], playback: { VYBZ_DEMO: demo }, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    [kaia, fan, mod, imposter] = (await h.db
      .insert(schema.user)
      .values([
        { id: "u_k", name: "Kaia", email: "k@x.com", handle: "kaia" },
        { id: "u_f", name: "Fan", email: "f@x.com", handle: "fan" },
        { id: "u_m", name: "Mod", email: "m@x.com", handle: "mod", role: "MODERATOR" },
        { id: "u_i", name: "Imp", email: "i@x.com", handle: "imp" },
      ])
      .returning()) as [UserRow, UserRow, UserRow, UserRow];
    await runDailyDrops(deps, { force: true });
  });
  afterAll(() => h?.close());

  it("claims with a posted code, gets verified once, and shows a badge", async () => {
    const { code } = await myArtistProfile(deps, kaia);
    expect(code).toMatch(/^VYBZ-[0-9A-F]{6}$/);
    await expect(claimArtistProfile(deps, kaia, { name: "Kaia Stone", code, proofUrl: "not a link" })).rejects.toMatchObject({ code: "INVALID_PROOF" });
    const p = await claimArtistProfile(deps, kaia, { name: "Kaia Stone", code, proofUrl: "https://instagram.com/p/abc", links: { instagram: "https://instagram.com/kaia", website: "javascript:alert(1)" } });
    expect(p).toMatchObject({ status: "PENDING", code, links: { instagram: "https://instagram.com/kaia" } });
    // The public never sees the code or proof.
    const imp = await myArtistProfile(deps, imposter);
    await claimArtistProfile(deps, imposter, { name: "kaia stone", code: imp.code, proofUrl: "https://x.com/fake" });
    await expect(pendingArtistProfiles(deps, fan)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const pending = await pendingArtistProfiles(deps, mod);
    expect(pending.items).toHaveLength(2);
    await reviewArtistProfile(deps, mod, p.id, { action: "verify" });
    // Only one verified profile per artist name.
    const impId = pending.items.find((x) => x.owner.handle === "imp")!.id;
    await expect(reviewArtistProfile(deps, mod, impId, { action: "verify" })).rejects.toMatchObject({ code: "ARTIST_TAKEN" });
    expect((await profile(deps, null, "kaia")).artist).toEqual({ name: "Kaia Stone" });

    const page = await artistPage(deps, null, "kaia stone");
    expect(page.name).toBe("Kaia Stone");
    expect(page.profile).toMatchObject({ status: "VERIFIED", code: null, proofUrl: null, owner: { handle: "kaia" } });
    expect(page.releases.length).toBeGreaterThan(0);
  });

  it("lets a verified artist call out another artist; fans and the rival hear about it", async () => {
    const { items } = await listDrops(deps, fan, new URLSearchParams());
    const myAlbum = items.find((x) => x.artistName === "Kaia Stone" && x.kind === "ALBUM")!;
    const mySingle = items.find((x) => x.artistName === "Kaia Stone" && x.kind === "SINGLE")!;
    const theirAlbum = items.find((x) => x.artistName === "Dune Theory" && x.kind === "ALBUM")!;
    await followArtist(deps, fan, { releaseId: theirAlbum.id });

    await expect(challengeArtist(deps, fan, { mine: myAlbum.id, theirs: theirAlbum.id })).rejects.toMatchObject({ code: "NOT_AN_ARTIST" });
    await expect(challengeArtist(deps, kaia, { mine: theirAlbum.id, theirs: myAlbum.id })).rejects.toMatchObject({ code: "NOT_YOUR_RELEASE" });
    await expect(challengeArtist(deps, kaia, { mine: mySingle.id, theirs: theirAlbum.id })).rejects.toMatchObject({ code: "KIND_MISMATCH" });
    const war = await challengeArtist(deps, kaia, { mine: myAlbum.id, theirs: theirAlbum.id });
    expect(war.challenge).toEqual({ from: "Kaia Stone", to: "Dune Theory", fromHandle: "kaia" });
    expect(war.a.artistName).toBe("Kaia Stone");
    const notes = await h.db.select().from(schema.notification).where(eq(schema.notification.userId, fan.id));
    expect(notes.some((n) => n.title.includes("Kaia Stone challenged Dune Theory") && n.link === `/wars/${war.id}`)).toBe(true);
    const page = await artistPage(deps, null, "Kaia Stone");
    expect(page.wars.open).toBeGreaterThanOrEqual(1);
    expect(page.wars.recent.some((w) => w.id === war.id && w.challenge)).toBe(true);
  });
});
