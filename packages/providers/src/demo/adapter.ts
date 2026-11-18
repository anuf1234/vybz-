import type {
  AlbumCandidate,
  AlbumProvider,
  ArtistCandidate,
  BrowseProvider,
  MetadataProvider,
  PlaybackProvider,
  PlaybackSource,
  SearchOptions,
  TrackCandidate,
  ThemeQuery,
  TrackProviderRef,
} from "../types";

/**
 * A tiny built-in catalog of synthesized, rights-free tracks so the whole app
 * (battles, fair-listen gate, voting) works end to end without Apple Music or
 * YouTube keys. Development and testing only: the app refuses to enable it in
 * production.
 */

interface DemoTrack {
  id: string;
  title: string;
  artistName: string;
  releaseYear: number;
  genres: string[];
}

export const DEMO_TRACKS: readonly DemoTrack[] = [
  { id: "neon-hallway", title: "Neon Hallway", artistName: "The Midnight Arcade", releaseYear: 2003, genres: ["R&B"] },
  { id: "midnight-static", title: "Midnight Static", artistName: "Lumen Avenue", releaseYear: 2005, genres: ["R&B"] },
  { id: "velvet-circuit", title: "Velvet Circuit", artistName: "Kaia Stone", releaseYear: 2001, genres: ["Soul"] },
  { id: "glass-parade", title: "Glass Parade", artistName: "Northbound Echo", releaseYear: 2008, genres: ["Pop"] },
  { id: "low-tide-signal", title: "Low Tide Signal", artistName: "Harbor Lights Club", releaseYear: 2006, genres: ["R&B"] },
  { id: "pulse-garden", title: "Pulse Garden", artistName: "Iris Vale", releaseYear: 2012, genres: ["Electronic"] },
  { id: "paper-satellites", title: "Paper Satellites", artistName: "Dune Theory", releaseYear: 2015, genres: ["Indie"] },
  { id: "afterglow-drive", title: "Afterglow Drive", artistName: "Sable & the Static", releaseYear: 2019, genres: ["Synthwave"] },
];

const DURATION_MS = 40_000;

export interface DemoCatalogConfig {
  /** Origin that serves /demo/<id>.m4a and /demo/<id>.jpg, e.g. http://localhost:3000. */
  assetBaseUrl: string;
}

/** Demo albums: two-track records built from the demo tracks, for developing album wars. */
const DEMO_ALBUMS: readonly { id: string; title: string; artistName: string; releaseYear: number; tracks: string[] }[] = [
  { id: "after-hours-tapes", title: "After Hours Tapes", artistName: "The Midnight Arcade", releaseYear: 2004, tracks: ["neon-hallway", "midnight-static"] },
  { id: "velvet-and-glass", title: "Velvet & Glass", artistName: "Kaia Stone", releaseYear: 2008, tracks: ["velvet-circuit", "glass-parade"] },
  { id: "harbor-nights", title: "Harbor Nights", artistName: "Harbor Lights Club", releaseYear: 2012, tracks: ["low-tide-signal", "pulse-garden"] },
  { id: "satellite-drive", title: "Satellite Drive", artistName: "Dune Theory", releaseYear: 2019, tracks: ["paper-satellites", "afterglow-drive"] },
];

export class DemoCatalog implements MetadataProvider, PlaybackProvider, BrowseProvider, AlbumProvider {
  readonly kind = "VYBZ_DEMO" as const;

  constructor(private readonly config: DemoCatalogConfig) {}

  async search(query: string, opts: SearchOptions): Promise<TrackCandidate[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    const hits = DEMO_TRACKS.filter((t) => {
      const hay = `${t.title} ${t.artistName} ${t.genres.join(" ")} ${t.releaseYear}`.toLowerCase();
      return q === "*" || q === "demo" || words.every((w) => hay.includes(w));
    });
    return hits.slice(0, opts.limit ?? 15).map((t) => this.toCandidate(t));
  }

  async getTrack(externalId: string): Promise<TrackCandidate | null> {
    const t = DEMO_TRACKS.find((d) => d.id === externalId);
    return t ? this.toCandidate(t) : null;
  }

  async searchArtists(query: string, opts: SearchOptions): Promise<ArtistCandidate[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const names = [...new Set(DEMO_TRACKS.map((t) => t.artistName))];
    return names
      .filter((n) => q === "demo" || n.toLowerCase().includes(q))
      .slice(0, opts.limit ?? 8)
      .map((n) => this.toArtist(n));
  }

  async artistTopSongs(artistId: string): Promise<{ artist: ArtistCandidate; songs: TrackCandidate[] } | null> {
    const tracks = DEMO_TRACKS.filter((t) => artistSlug(t.artistName) === artistId);
    if (!tracks.length) return null;
    // Newest first stands in for popularity in the demo catalog.
    const songs = [...tracks].sort((a, b) => b.releaseYear - a.releaseYear).map((t) => this.toCandidate(t));
    return { artist: this.toArtist(tracks[0]!.artistName), songs };
  }

  async suggestions(_theme: ThemeQuery, opts: SearchOptions): Promise<TrackCandidate[]> {
    return DEMO_TRACKS.slice(0, opts.limit ?? 60).map((t) => this.toCandidate(t));
  }

  async searchAlbums(query: string, opts: SearchOptions): Promise<AlbumCandidate[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return DEMO_ALBUMS.filter((al) => q === "demo" || `${al.title} ${al.artistName}`.toLowerCase().includes(q))
      .slice(0, opts.limit ?? 15)
      .map((al) => this.toAlbum(al, false));
  }

  async getAlbum(externalId: string): Promise<AlbumCandidate | null> {
    const al = DEMO_ALBUMS.find((x) => x.id === externalId);
    return al ? this.toAlbum(al, true) : null;
  }

  async topAlbums(): Promise<AlbumCandidate[]> {
    return DEMO_ALBUMS.map((al) => this.toAlbum(al, false));
  }

  private toAlbum(al: (typeof DEMO_ALBUMS)[number], withTracks: boolean): AlbumCandidate {
    return {
      provider: "VYBZ_DEMO",
      externalId: al.id,
      title: al.title,
      artistName: al.artistName,
      releaseYear: al.releaseYear,
      artwork: { url: this.asset(al.tracks[0]!, "jpg"), width: 300, height: 300 },
      trackCount: al.tracks.length,
      isSingle: false,
      ...(withTracks ? { tracks: al.tracks.map((id) => this.toCandidate(DEMO_TRACKS.find((t) => t.id === id)!)) } : {}),
    };
  }

  private toArtist(name: string): ArtistCandidate {
    const first = DEMO_TRACKS.find((t) => t.artistName === name)!;
    return {
      provider: "VYBZ_DEMO",
      externalId: artistSlug(name),
      name,
      genres: [...new Set(DEMO_TRACKS.filter((t) => t.artistName === name).flatMap((t) => t.genres))],
      artwork: { url: this.asset(first.id, "jpg"), width: 300, height: 300 },
    };
  }

  sources(ref: TrackProviderRef): PlaybackSource[] {
    if (!DEMO_TRACKS.some((d) => d.id === ref.externalId)) return [];
    return [
      {
        tier: "HOSTED_FULL",
        provider: "VYBZ_DEMO",
        url: this.asset(ref.externalId, "m4a"),
        attribution: { provider: "VYBZ_DEMO", label: "VYBZ demo catalog" },
        restrictions: { noOverlay: false },
      },
    ];
  }

  private asset(id: string, ext: "m4a" | "jpg") {
    return `${this.config.assetBaseUrl.replace(/\/$/, "")}/demo/${id}.${ext}`;
  }

  private toCandidate(t: DemoTrack): TrackCandidate {
    return {
      provider: "VYBZ_DEMO",
      externalId: t.id,
      title: t.title,
      artistName: t.artistName,
      albumName: "VYBZ Demo Sessions",
      durationMs: DURATION_MS,
      releaseYear: t.releaseYear,
      genres: t.genres,
      explicit: false,
      artwork: { url: this.asset(t.id, "jpg"), width: 300, height: 300 },
    };
  }
}

function artistSlug(name: string): string {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
