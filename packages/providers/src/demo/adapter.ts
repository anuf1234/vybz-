import type {
  MetadataProvider,
  PlaybackProvider,
  PlaybackSource,
  SearchOptions,
  TrackCandidate,
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

export class DemoCatalog implements MetadataProvider, PlaybackProvider {
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
