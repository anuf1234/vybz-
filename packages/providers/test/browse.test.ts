import { describe, expect, it } from "vitest";
import { AppleMusicAdapter, DemoCatalog, isBrowseProvider } from "../src";
import { appleSong, stubFetch } from "./fixtures";

const opts = { storefront: "us" };
const song = (id: string, name: string, artistName = "TLC", releaseDate = "1999-02-01", genreNames = ["R&B/Soul", "Music"]) => ({
  ...appleSong,
  id,
  attributes: { ...appleSong.attributes, name, artistName, releaseDate, genreNames, isrc: `ISRC${id}` },
});
const artist = { id: "4415", type: "artists", attributes: { name: "TLC", genreNames: ["R&B/Soul"], url: "https://music.apple.com/us/artist/tlc/4415" } };
const adapter = (routes: Parameters<typeof stubFetch>[0]) => {
  const stub = stubFetch(routes);
  return { a: new AppleMusicAdapter({ developerToken: async () => "dev-token", fetch: stub.fetch }), calls: stub.calls };
};

describe("Apple Music browsing", () => {
  it("is a browse provider", () => {
    expect(isBrowseProvider(adapter({}).a)).toBe(true);
  });

  it("searches artists", async () => {
    const { a, calls } = adapter({ "/catalog/us/search": { results: { artists: { data: [artist] } } } });
    const found = await a.searchArtists("tlc", opts);
    expect(found).toEqual([{ provider: "APPLE_MUSIC", externalId: "4415", name: "TLC", genres: ["R&B/Soul"], externalUrl: artist.attributes.url }]);
    expect(calls[0]!.url.searchParams.get("types")).toBe("artists");
  });

  it("returns an artist's top songs in Apple's popularity order, following one page", async () => {
    const { a, calls } = adapter({
      "/artists/4415": { data: [artist] },
      "/artists/4415/view/top-songs": (url: URL) =>
        url.searchParams.get("offset")
          ? { data: [song("3", "Creep"), song("1", "No Scrubs")] }
          : { data: [song("1", "No Scrubs"), song("2", "Waterfalls"), { id: "mv1", type: "music-videos", attributes: {} }], next: "/v1/catalog/us/artists/4415/view/top-songs?offset=20" },
    });
    const res = await a.artistTopSongs("4415", opts);
    expect(res!.artist.name).toBe("TLC");
    // Order kept, music video skipped, duplicate from page two dropped.
    expect(res!.songs.map((s) => s.title)).toEqual(["No Scrubs", "Waterfalls", "Creep"]);
    expect(calls.some((c) => c.url.searchParams.get("offset") === "20")).toBe(true);
  });

  it("returns null for an unknown artist", async () => {
    const { a } = adapter({});
    expect(await a.artistTopSongs("nope", opts)).toBeNull();
  });

  it("suggests chart hits per genre, interleaved, when there's no era", async () => {
    const { a, calls } = adapter({
      "/catalog/us/genres": { data: [{ id: "15", attributes: { name: "R&B/Soul" } }, { id: "18", attributes: { name: "Hip-Hop/Rap" } }] },
      "/catalog/us/charts": (url: URL) =>
        url.searchParams.get("genre") === "15"
          ? { results: { songs: [{ data: [song("r1", "R1"), song("r2", "R2")] }] } }
          : { results: { songs: [{ data: [song("h1", "H1", "Nas", "2024-01-01", ["Hip-Hop/Rap"])] }] } },
    });
    const res = await a.suggestions({ genres: ["rnb", "hiphop"] }, opts);
    expect(res.map((s) => s.title)).toEqual(["R1", "H1", "R2"]);
    expect(calls.filter((c) => c.url.pathname.endsWith("/charts")).map((c) => c.url.searchParams.get("genre"))).toEqual(["15", "18"]);
    // Genre ids are cached per storefront.
    await a.suggestions({ genres: ["rnb"] }, opts);
    expect(calls.filter((c) => c.url.pathname.endsWith("/genres"))).toHaveLength(1);
  });

  it("uses Apple's own decade playlists plus a song search for an era", async () => {
    const { a, calls } = adapter({
      "/catalog/us/search": (url: URL) =>
        url.searchParams.get("types") === "playlists"
          ? {
              results: {
                playlists: {
                  data: [
                    { id: "pl.user", attributes: { name: "my 90s rnb", curatorName: "someone" } },
                    { id: "pl.apple", attributes: { name: "90s R&B Essentials", curatorName: "Apple Music" } },
                  ],
                },
              },
            }
          : { results: { songs: { data: [song("s1", "Searched")] } } },
      "/playlists/pl.apple/tracks": { data: [song("p1", "Playlist one"), song("p2", "Playlist two")] },
    });
    const res = await a.suggestions({ genres: ["rnb"], eraFrom: 1990, eraTo: 1999 }, opts);
    expect(res.map((s) => s.title)).toEqual(["Playlist one", "Searched", "Playlist two"]);
    const searches = calls.filter((c) => c.url.pathname.endsWith("/search")).map((c) => c.url.searchParams.get("term"));
    expect(searches).toContain("90s R&B");
    expect(calls.some((c) => c.url.pathname.endsWith("/playlists/pl.user/tracks"))).toBe(false);
  });
});

describe("demo catalog browsing", () => {
  const demo = new DemoCatalog({ assetBaseUrl: "http://localhost:3000" });
  it("finds artists and lists their songs", async () => {
    const [a] = await demo.searchArtists("kaia", opts);
    expect(a).toMatchObject({ provider: "VYBZ_DEMO", externalId: "kaia-stone", name: "Kaia Stone" });
    const res = await demo.artistTopSongs("kaia-stone");
    expect(res!.songs.map((s) => s.title)).toEqual(["Velvet Circuit"]);
    expect(await demo.artistTopSongs("nobody")).toBeNull();
  });
  it("offers every track as a suggestion", async () => {
    expect((await demo.suggestions({ genres: [] }, opts)).length).toBe(8);
  });
});
