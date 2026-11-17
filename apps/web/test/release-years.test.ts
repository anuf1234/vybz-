import { type DbHandle, eq, schema } from "@vybz/db";
import { AppleMusicAdapter, type MetadataProvider, type ReleaseYearLookup, type TrackCandidate, YouTubeAdapter } from "@vybz/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CatalogDeps, ensureTrack } from "../src/server/catalog";
import { TEST_DB_URL, freshDb } from "./helpers";

/** A YouTube catalog whose videos carry no release year (upload dates aren't used). */
class FakeYouTube implements MetadataProvider {
  readonly kind = "YOUTUBE" as const;
  constructor(private readonly items: TrackCandidate[]) {}
  async search() {
    return this.items;
  }
  async getTrack(id: string) {
    const v = this.items.find((i) => i.externalId === id);
    return v ? { ...v } : null;
  }
}

class FakeYears implements ReleaseYearLookup {
  asked: [string, string][] = [];
  constructor(private readonly years: Record<string, number>) {}
  async firstReleaseYear(artist: string, title: string) {
    this.asked.push([artist, title]);
    return this.years[`${artist}|${title}`] ?? null;
  }
}

describe.skipIf(!TEST_DB_URL)("release years for YouTube picks", () => {
  let h: DbHandle;
  const yt = new FakeYouTube([
    { provider: "YOUTUBE", externalId: "bump", title: "R. Kelly - Bump n' Grind (Official Video)", artistName: "RKellyVEVO", durationMs: 255_000, embeddable: true },
    { provider: "YOUTUBE", externalId: "unknown", title: "Nobody - Lost Tape", artistName: "Nobody", durationMs: 100_000, embeddable: true },
  ]);
  const years = new FakeYears({ "R. Kelly|Bump n' Grind": 1993 });
  let deps: CatalogDeps;

  beforeAll(async () => {
    h = await freshDb();
    deps = {
      metadata: [yt],
      playback: { APPLE_MUSIC: new AppleMusicAdapter({ developerToken: async () => "t" }), YOUTUBE: new YouTubeAdapter({ apiKey: "k" }) },
      youtube: null,
      releaseYears: years,
      storefront: "us",
    };
  });
  afterAll(() => h?.close());

  it("looks up the original release year instead of using the upload date", async () => {
    const stored = await ensureTrack(h.db, deps, "YOUTUBE:bump");
    expect(stored.track.releaseYear).toBe(1993);
    expect(years.asked).toContainEqual(["R. Kelly", "Bump n' Grind"]);
  });

  it("leaves the year empty when nobody knows it", async () => {
    const stored = await ensureTrack(h.db, deps, "YOUTUBE:unknown");
    expect(stored.track.releaseYear).toBeNull();
  });

  it("fills in a stored track whose year was cleared", async () => {
    await h.db.update(schema.track).set({ releaseYear: null }).where(eq(schema.track.title, "R. Kelly - Bump n' Grind (Official Video)"));
    const again = await ensureTrack(h.db, deps, "YOUTUBE:bump");
    expect(again.track.releaseYear).toBe(1993);
  });
});
