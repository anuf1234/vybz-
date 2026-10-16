import type {
  MetadataProvider,
  PlaybackProvider,
  PlaybackSource,
  SearchOptions,
  TrackCandidate,
  TrackProviderRef,
  ViewerContext,
} from "../types";

/**
 * A stand-in for Apple Music when no MusicKit key is configured, so battles
 * can be built, demoed and tested end to end. Real song metadata, no real
 * audio: previews point at a tone generator served by the app in development.
 * Never enabled on the production deployment.
 */

type Row = [id: string, title: string, artist: string, album: string, year: number, durationMs: number, genre: string];

const ROWS: Row[] = [
  ["fx-1001", "No Scrubs", "TLC", "FanMail", 1999, 214_000, "R&B/Soul"],
  ["fx-1002", "Try Again", "Aaliyah", "Romeo Must Die", 2000, 284_000, "R&B/Soul"],
  ["fx-1003", "Say My Name", "Destiny's Child", "The Writing's on the Wall", 1999, 271_000, "R&B/Soul"],
  ["fx-1004", "Ignition (Remix)", "R. Kelly", "Chocolate Factory", 2003, 186_000, "R&B/Soul"],
  ["fx-1005", "Crazy in Love", "Beyoncé", "Dangerously in Love", 2003, 236_000, "R&B/Soul"],
  ["fx-1006", "Yeah!", "Usher", "Confessions", 2004, 250_000, "R&B/Soul"],
  ["fx-1007", "Burn", "Usher", "Confessions", 2004, 231_000, "R&B/Soul"],
  ["fx-1008", "Let Me Love You", "Mario", "Turning Point", 2004, 256_000, "R&B/Soul"],
  ["fx-1009", "We Belong Together", "Mariah Carey", "The Emancipation of Mimi", 2005, 201_000, "R&B/Soul"],
  ["fx-1010", "So Sick", "Ne-Yo", "In My Own Words", 2006, 207_000, "R&B/Soul"],
  ["fx-1011", "Irreplaceable", "Beyoncé", "B'Day", 2006, 228_000, "R&B/Soul"],
  ["fx-1012", "Umbrella", "Rihanna", "Good Girl Gone Bad", 2007, 276_000, "Pop"],
  ["fx-1013", "No One", "Alicia Keys", "As I Am", 2007, 254_000, "R&B/Soul"],
  ["fx-1014", "Foolish", "Ashanti", "Ashanti", 2002, 227_000, "R&B/Soul"],
  ["fx-1015", "Hot in Herre", "Nelly", "Nellyville", 2002, 228_000, "Hip-Hop/Rap"],
  ["fx-1016", "Family Affair", "Mary J. Blige", "No More Drama", 2001, 265_000, "R&B/Soul"],
  ["fx-1017", "Get Ur Freak On", "Missy Elliott", "Miss E... So Addictive", 2001, 211_000, "Hip-Hop/Rap"],
  ["fx-1018", "Untitled (How Does It Feel)", "D'Angelo", "Voodoo", 2000, 430_000, "R&B/Soul"],
  ["fx-1019", "Fallin'", "Alicia Keys", "Songs in A Minor", 2001, 210_000, "R&B/Soul"],
  ["fx-1020", "Waterfalls", "TLC", "CrazySexyCool", 1994, 279_000, "R&B/Soul"],
  ["fx-1021", "Blinding Lights", "The Weeknd", "After Hours", 2019, 200_000, "R&B/Soul"],
  ["fx-1022", "Kill Bill", "SZA", "SOS", 2022, 153_000, "R&B/Soul"],
  ["fx-1023", "Superstition", "Stevie Wonder", "Talking Book", 1972, 265_000, "R&B/Soul"],
  ["fx-1024", "Get Lucky", "Daft Punk", "Random Access Memories", 2013, 369_000, "Electronic"],
];

export const FIXTURE_TRACKS: readonly TrackCandidate[] = ROWS.map(([id, title, artist, album, year, durationMs, genre]) => ({
  provider: "APPLE_MUSIC",
  externalId: id,
  title,
  artistName: artist,
  albumName: album,
  releaseYear: year,
  durationMs,
  genres: [genre],
  explicit: false,
  externalUrl: `https://music.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}`,
}));

const PREVIEW_MS = 30_000;

export class FixtureMusicAdapter implements MetadataProvider, PlaybackProvider {
  readonly kind = "APPLE_MUSIC" as const;

  /** @param previewBase URL prefix for the dev tone endpoint, e.g. "/api/dev/tone". */
  constructor(private readonly previewBase: string) {}

  async search(query: string, opts: SearchOptions): Promise<TrackCandidate[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return FIXTURE_TRACKS.filter((t) => {
      const hay = `${t.title} ${t.artistName} ${t.albumName}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    })
      .slice(0, opts.limit ?? 15)
      .map((t) => this.withPreview(t));
  }

  async getTrack(externalId: string): Promise<TrackCandidate | null> {
    const t = FIXTURE_TRACKS.find((x) => x.externalId === externalId);
    return t ? this.withPreview(t) : null;
  }

  sources(ref: TrackProviderRef, _viewer: ViewerContext): PlaybackSource[] {
    const attribution = { provider: this.kind, label: "Sample audio" };
    if (!ref.previewUrl) return [];
    return [
      {
        tier: "PREVIEW",
        provider: this.kind,
        url: ref.previewUrl,
        attribution,
        restrictions: { maxPlayMs: PREVIEW_MS, noOverlay: true },
      },
    ];
  }

  private withPreview(t: TrackCandidate): TrackCandidate {
    return { ...t, previewUrl: `${this.previewBase}/${t.externalId}` };
  }
}
