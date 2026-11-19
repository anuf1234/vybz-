import { describe, expect, it } from "vitest";
import { AppleMusicAdapter, DemoCatalog, isReleaseProvider } from "../src";
import { appleSong, stubFetch } from "./fixtures";

const opts = { storefront: "us" };
const song = (id: string, albumName: string, albumId: string, artistName = "New Artist") => ({
  ...appleSong,
  id,
  attributes: { ...appleSong.attributes, name: `Song ${id}`, albumName, artistName, releaseDate: "2026-11-14", url: `https://music.apple.com/us/album/x/${albumId}?i=${id}` },
});
const album = (id: string, name: string, isSingle = false) => ({
  id,
  type: "albums",
  attributes: { name, artistName: "Chart Act", releaseDate: "2026-11-07", trackCount: isSingle ? 1 : 12, isSingle, url: `https://music.apple.com/us/album/x/${id}` },
});

describe("new releases", () => {
  it("both adapters are release providers", () => {
    expect(isReleaseProvider(new DemoCatalog({ assetBaseUrl: "http://x" }))).toBe(true);
    expect(isReleaseProvider(new AppleMusicAdapter({ developerToken: async () => "t" }))).toBe(true);
  });

  it("merges editorial playlists and charts into releases, one per album", async () => {
    const stub = stubFetch({
      "/catalog/us/search": { results: { playlists: { data: [{ id: "pl.user", attributes: { name: "New Music Daily", curatorName: "Someone" } }, { id: "pl.nmd", attributes: { name: "New Music Daily", curatorName: "Apple Music" } }] } } },
      "/playlists/pl.nmd/tracks": { data: [song("1", "Fresh One - Single", "900"), song("2", "Big EP - EP", "901"), song("3", "Big EP - EP", "901"), { id: "v", type: "music-videos", attributes: {} }] },
      "/catalog/us/charts": (url: URL) =>
        url.searchParams.get("types") === "songs" ? { results: { songs: [{ data: [song("4", "Fresh One - Single", "900")] }] } } : { results: { albums: [{ data: [album("950", "Chart Album")] }] } },
    });
    const a = new AppleMusicAdapter({ developerToken: async () => "t", fetch: stub.fetch, newReleasePlaylists: ["New Music Daily"] });
    const out = await a.newReleases(opts);
    expect(out.map((x) => [x.externalId, x.title, x.format])).toEqual([
      ["900", "Fresh One", "SINGLE"],
      ["950", "Chart Album", "ALBUM"],
      ["901", "Big EP", "EP"],
    ]);
    expect(out[0]).toMatchObject({ releaseDate: "2026-11-14", externalUrl: "https://music.apple.com/us/album/x/900", isSingle: true });
    // Only Apple's own playlist was read.
    expect(stub.calls.some((c) => c.url.pathname.includes("pl.user"))).toBe(false);
  });

  it("still answers when a source fails", async () => {
    const stub = stubFetch({ "/catalog/us/charts": { results: { albums: [{ data: [album("950", "Chart Album")] }] } } });
    const a = new AppleMusicAdapter({ developerToken: async () => "t", fetch: stub.fetch, newReleasePlaylists: ["Missing"] });
    expect((await a.newReleases(opts)).map((x) => x.externalId)).toEqual(["950"]);
  });

  it("reads an artist's latest release", async () => {
    const stub = stubFetch({ "/artists/77/view/latest-release": { data: [album("960", "Newest - Single", true)] } });
    const a = new AppleMusicAdapter({ developerToken: async () => "t", fetch: stub.fetch });
    expect(await a.latestRelease("77", opts)).toMatchObject({ externalId: "960", title: "Newest", format: "SINGLE" });
    expect(await a.latestRelease("78", opts)).toBeNull();
  });

  it("reads a person's recently played songs with their Music User Token", async () => {
    const stub = stubFetch({ "/me/recent/played/tracks": { data: [song("1", "Fresh One - Single", "900"), { id: "pl", type: "playlists", attributes: {} }, song("2", "Big EP - EP", "901")] } });
    const a = new AppleMusicAdapter({ developerToken: async () => "dev", fetch: stub.fetch });
    expect(await a.recentlyPlayed("user-token")).toEqual([
      { songId: "1", albumId: "900", title: "Song 1", artistName: "New Artist" },
      { songId: "2", albumId: "901", title: "Song 2", artistName: "New Artist" },
    ]);
    expect((stub.calls[0]!.init!.headers as Record<string, string>)["Music-User-Token"]).toBe("user-token");
  });
});
