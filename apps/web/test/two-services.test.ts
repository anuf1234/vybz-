import { type DbHandle, schema } from "@vybz/db";
import { AppleMusicAdapter, type MetadataProvider, type SearchOptions, type TrackCandidate, YouTubeAdapter } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BattleDeps,
  type UserRow,
  acceptBattle,
  castVote,
  createBattle,
  getBattleView,
  recordListen,
  submitPick,
} from "../src/server/battles/service";
import { roundOptions } from "../src/server/battles/view";
import { searchCatalog, viewerContext } from "../src/server/catalog";
import { TEST_DB_URL, freshDb } from "./helpers";

/* Canned catalogs. Playback logic comes from the real adapters. */

const APPLE: TrackCandidate[] = [
  { provider: "APPLE_MUSIC", externalId: "101", title: "U Remind Me", artistName: "Usher", releaseYear: 2001, durationMs: 243_000, genres: ["R&B/Soul"], isrc: "USLF20100001", previewUrl: "https://audio.example/101.m4a", externalUrl: "https://music.apple.com/us/song/101" },
  { provider: "APPLE_MUSIC", externalId: "102", title: "No Scrubs", artistName: "TLC", releaseYear: 1999, durationMs: 214_000, genres: ["R&B/Soul"], isrc: "USLF29900002", previewUrl: "https://audio.example/102.m4a", externalUrl: "https://music.apple.com/us/song/102" },
  { provider: "APPLE_MUSIC", externalId: "103", title: "Try Again", artistName: "Aaliyah", releaseYear: 2000, durationMs: 284_000, genres: ["R&B/Soul"], isrc: "USLF20000003", previewUrl: "https://audio.example/103.m4a", externalUrl: "https://music.apple.com/us/song/103" },
];
const YT: TrackCandidate[] = [
  { provider: "YOUTUBE", externalId: "yt-usher", title: "Usher - U Remind Me (Official Video)", artistName: "Usher", durationMs: 244_000, embeddable: true, externalUrl: "https://www.youtube.com/watch?v=yt-usher" },
  { provider: "YOUTUBE", externalId: "yt-tlc", title: "TLC - No Scrubs (Official Video)", artistName: "TLC", durationMs: 215_000, embeddable: true },
  { provider: "YOUTUBE", externalId: "yt-aaliyah", title: "Aaliyah - Try Again (Official Video)", artistName: "Aaliyah", durationMs: 283_000, embeddable: true },
  // On YouTube only: a fan-favourite live version with no Apple Music match.
  { provider: "YOUTUBE", externalId: "yt-live", title: "Mystery Singer - Basement Session (Live)", artistName: "Mystery Singer", durationMs: 200_000, embeddable: true },
];

class FakeCatalog implements MetadataProvider {
  calls = 0;
  constructor(
    readonly kind: "APPLE_MUSIC" | "YOUTUBE",
    private readonly items: TrackCandidate[],
  ) {}
  async search(q: string, _o: SearchOptions) {
    this.calls++;
    const words = q.toLowerCase().split(/\s+/);
    return this.items.filter((i) => words.some((w) => `${i.title} ${i.artistName}`.toLowerCase().includes(w)));
  }
  async getTrack(id: string) {
    return this.items.find((i) => i.externalId === id) ?? null;
  }
}

describe.skipIf(!TEST_DB_URL)("Apple Music and YouTube in one battle", () => {
  let h: DbHandle;
  let deps: BattleDeps;
  const u: Record<string, UserRow> = {};
  const apple = new FakeCatalog("APPLE_MUSIC", APPLE);
  const yt = new FakeCatalog("YOUTUBE", YT);
  const playback = {
    APPLE_MUSIC: new AppleMusicAdapter({ developerToken: async () => "t" }),
    YOUTUBE: new YouTubeAdapter({ apiKey: "k" }),
  };

  beforeAll(async () => {
    h = await freshDb();
    deps = { db: h.db, catalog: { metadata: [apple, yt], playback, youtube: yt, storefront: "us" }, requireVerifiedEmail: false, aiJudge: null };
    for (const handle of ["ann", "ben", "cat"]) {
      const [row] = await h.db.insert(schema.user).values({ id: `u_${handle}`, name: handle, email: `${handle}@x.com`, handle }).returning();
      u[handle] = row!;
    }
  });
  afterAll(() => h?.close());

  it("searches either catalog", async () => {
    const viewer = viewerContext("us");
    expect((await searchCatalog(deps.catalog, "usher", viewer)).map((x) => x.catalogId)).toEqual(["APPLE_MUSIC:101"]);
    expect((await searchCatalog(deps.catalog, "usher", viewer, "YOUTUBE")).map((x) => x.catalogId)).toEqual(["YOUTUBE:yt-usher"]);
  });

  let battleId = "";

  it("offers the round on YouTube (full) and Apple Music (preview, or full for subscribers)", async () => {
    ({ id: battleId } = await createBattle(deps, u.ann!, { title: "Y2K R&B", rules: { roundCount: 3, constraints: { genres: ["rnb"], eraFrom: 1995, eraTo: 2005 }, fairListen: { minPlayedMs: 0 } } }));
    await acceptBattle(deps, u.ben!, battleId);
    // Ann picks from Apple Music (matched to YouTube at submission).
    await submitPick(deps, u.ann!, battleId, 0, { catalogIds: ["APPLE_MUSIC:101"] });
    // Ben picks from YouTube (matched back to Apple Music: gets year + genre for the era rule).
    await submitPick(deps, u.ben!, battleId, 0, { catalogIds: ["YOUTUBE:yt-tlc"] });

    const refs = await h.db.select().from(schema.trackProviderRef);
    const tlc = refs.filter((r) => r.externalId === "102" || r.externalId === "yt-tlc");
    expect(new Set(tlc.map((r) => r.trackId)).size).toBe(1); // one canonical track with both refs

    const guest = await getBattleView(deps, u.cat!, battleId);
    let r = guest.rounds[0]!;
    expect(r.viewer.playbackOptions).toEqual([
      { provider: "YOUTUBE", tier: "EMBED", label: "YouTube" },
      { provider: "APPLE_MUSIC", tier: "PREVIEW", label: "Apple Music" },
    ]);
    const t = r.entries[0]!.tracks[0]!;
    expect(t.sources.map((s) => `${s.provider}:${s.tier}`)).toEqual(["YOUTUBE:EMBED", "APPLE_MUSIC:PREVIEW"]);
    expect(t.playback).toEqual(t.sources[0]);

    const subscriber = await getBattleView(deps, u.cat!, battleId, { appleMusicFull: true });
    r = subscriber.rounds[0]!;
    expect(r.viewer.playbackOptions.map((o) => `${o.provider}:${o.tier}`)).toEqual(["APPLE_MUSIC:PROVIDER_FULL", "YOUTUBE:EMBED"]);
    expect(r.entries[0]!.tracks[0]!.sources[0]).toMatchObject({ sdk: { kind: "musickit" } });
  });

  it("lets a listener vote on Apple Music, and refuses tiers their device can't play", async () => {
    const v = await getBattleView(deps, u.cat!, battleId);
    const subs = v.rounds[0]!.entries.map((e) => e.tracks[0]!.submissionId);
    await expect(recordListen(deps, u.cat!, battleId, 0, { submissionId: subs[0]!, playedMs: 0, tier: "PROVIDER_FULL" })).rejects.toMatchObject({ code: "INVALID_TIER" });

    // Heard one side on YouTube and the other as an Apple preview: not comparable.
    await recordListen(deps, u.cat!, battleId, 0, { submissionId: subs[0]!, playedMs: 0, tier: "EMBED" });
    await recordListen(deps, u.cat!, battleId, 0, { submissionId: subs[1]!, playedMs: 0, tier: "PREVIEW" });
    expect((await getBattleView(deps, u.cat!, battleId)).rounds[0]!.viewer.voteBlockedReason).toBe("TIER_MISMATCH");

    // Both on Apple Music (full, as a subscriber): vote unlocks.
    for (const s of subs) await recordListen(deps, u.cat!, battleId, 0, { submissionId: s, playedMs: 0, tier: "PROVIDER_FULL" }, { appleMusicFull: true });
    const after = await getBattleView(deps, u.cat!, battleId, { appleMusicFull: true });
    expect(after.rounds[0]!.entries[0]!.tracks[0]!.listen.tier).toBe("PROVIDER_FULL");
    expect(after.rounds[0]!.viewer.canVote).toBe(true);
    await castVote(deps, u.cat!, battleId, 0, subs[0]!);
  });

  it("YouTube-only picks still play for everyone on YouTube", async () => {
    // Round 2 has no era rule issue for Ann; Ben picks a YouTube-only video. Use a battle without an era rule.
    const { id } = await createBattle(deps, u.ann!, { title: "Anything goes", rules: { roundCount: 3 } });
    await acceptBattle(deps, u.ben!, id);
    await submitPick(deps, u.ann!, id, 0, { catalogIds: ["APPLE_MUSIC:103"] });
    await submitPick(deps, u.ben!, id, 0, { catalogIds: ["YOUTUBE:yt-live"] });
    const r = (await getBattleView(deps, u.cat!, id)).rounds[0]!;
    expect(r.viewer.playbackOptions.map((o) => o.provider)).toEqual(["YOUTUBE"]); // Apple can't play both sides
  });
});

describe("roundOptions", () => {
  const src = (provider: "APPLE_MUSIC" | "YOUTUBE", tier: "EMBED" | "PREVIEW" | "PROVIDER_FULL" | "LINK_OUT") =>
    ({ provider, tier, attribution: { provider, label: provider }, restrictions: { noOverlay: true } }) as never;
  it("keeps only services every track supports, at a tier every track shares", () => {
    expect(roundOptions([[src("YOUTUBE", "EMBED"), src("APPLE_MUSIC", "PREVIEW")], [src("APPLE_MUSIC", "PROVIDER_FULL"), src("APPLE_MUSIC", "PREVIEW"), src("YOUTUBE", "EMBED")]]).map((o) => `${o.provider}:${o.tier}`)).toEqual(["YOUTUBE:EMBED", "APPLE_MUSIC:PREVIEW"]);
    expect(roundOptions([[src("APPLE_MUSIC", "LINK_OUT")], [src("APPLE_MUSIC", "LINK_OUT")]])).toEqual([]);
  });
});
