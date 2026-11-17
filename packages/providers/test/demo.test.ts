import { describe, expect, it } from "vitest";
import { DemoCatalog, resolvePlayback } from "../src";

const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000/" });
const guest = { userId: null, storefront: "us", connections: [] };

describe("DemoCatalog", () => {
  it("searches by title, artist, genre and year", async () => {
    expect((await demo.search("neon", { storefront: "us" })).map((t) => t.externalId)).toEqual(["neon-hallway"]);
    expect((await demo.search("r&b 2005", { storefront: "us" })).map((t) => t.title)).toEqual(["Midnight Static"]);
    expect(await demo.search("demo", { storefront: "us" })).toHaveLength(8);
    expect(await demo.search("  ", { storefront: "us" })).toEqual([]);
  });

  it("resolves hosted playback with asset URLs", async () => {
    const t = (await demo.getTrack("glass-parade"))!;
    expect(t.artwork?.url).toBe("http://localhost:3000/demo/glass-parade.jpg");
    const sources = resolvePlayback([{ provider: "VYBZ_DEMO", externalId: t.externalId }], guest, { VYBZ_DEMO: demo });
    expect(sources).toEqual([expect.objectContaining({ tier: "HOSTED_FULL", url: "http://localhost:3000/demo/glass-parade.m4a" })]);
    expect(await demo.getTrack("nope")).toBeNull();
  });
});
