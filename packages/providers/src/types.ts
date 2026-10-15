/**
 * Provider abstraction for VYBZ.
 *
 * Three separate concerns, three separate layers:
 *   1. Metadata   – what a song is (title, artists, ISRC, artwork).
 *   2. References – where that song lives on each provider.
 *   3. Playback   – how *this viewer* may hear it right now. Computed per
 *                   request, never stored, never proxied or re-hosted.
 */

export type ProviderKind = "APPLE_MUSIC" | "YOUTUBE";

/** Ordered best → worst. See `TIER_RANK`. */
export type PlaybackTier =
  | "HOSTED_FULL" // VYBZ-hosted, rights-cleared audio (later phase)
  | "PROVIDER_FULL" // viewer's own subscription through the provider SDK
  | "EMBED" // provider's own visible player (YouTube IFrame)
  | "PREVIEW" // provider-sanctioned clip (Apple Music catalog preview)
  | "LINK_OUT"; // metadata only, open in the provider's app

export const TIER_RANK: Record<PlaybackTier, number> = {
  HOSTED_FULL: 5,
  PROVIDER_FULL: 4,
  EMBED: 3,
  PREVIEW: 2,
  LINK_OUT: 1,
};

export interface Artwork {
  /** URL template or concrete URL hosted by the provider. Never re-hosted. */
  url: string;
  width?: number;
  height?: number;
}

/** A provider's view of a track, before it is merged into the canonical catalog. */
export interface TrackCandidate {
  provider: ProviderKind;
  externalId: string;
  title: string;
  artistName: string;
  albumName?: string;
  durationMs?: number;
  isrc?: string;
  releaseYear?: number;
  genres?: string[];
  explicit?: boolean;
  artwork?: Artwork;
  externalUrl?: string;
  /** Only for providers whose terms sanction previews (Apple Music). */
  previewUrl?: string;
  /** YouTube: whether the owner allows embedding. */
  embeddable?: boolean;
}

export interface TrackProviderRef {
  provider: ProviderKind;
  externalId: string;
  externalUrl?: string;
  previewUrl?: string;
  embeddable?: boolean;
}

export interface ProviderConnectionInfo {
  provider: ProviderKind;
  /** Apple Music: true when MusicKit reports an active subscription. */
  canPlayFullCatalog: boolean;
}

export interface ViewerContext {
  userId: string | null; // null = guest
  storefront: string; // ISO 3166-1 alpha-2, lower case, e.g. "us"
  connections: ProviderConnectionInfo[];
}

export interface Attribution {
  provider: ProviderKind;
  label: string;
  href?: string;
}

export interface PlaybackRestrictions {
  /** Max audible duration, e.g. a 30s preview. */
  maxPlayMs?: number;
  /** The provider's player must stay visible (YouTube). */
  mustShowPlayer?: boolean;
  /** Never mix, overlay, crossfade or time-stretch this audio. */
  noOverlay: boolean;
}

export type PlaybackSource =
  | {
      tier: "PROVIDER_FULL";
      provider: "APPLE_MUSIC";
      sdk: { kind: "musickit"; catalogId: string };
      attribution: Attribution;
      restrictions: PlaybackRestrictions;
    }
  | {
      tier: "EMBED";
      provider: "YOUTUBE";
      embed: { kind: "youtube"; videoId: string };
      attribution: Attribution;
      restrictions: PlaybackRestrictions;
    }
  | {
      tier: "PREVIEW";
      provider: "APPLE_MUSIC";
      url: string;
      attribution: Attribution;
      restrictions: PlaybackRestrictions;
    }
  | {
      tier: "LINK_OUT";
      provider: ProviderKind;
      href: string;
      attribution: Attribution;
      restrictions: PlaybackRestrictions;
    };

export interface SearchOptions {
  storefront: string;
  limit?: number;
}

export interface MetadataProvider {
  readonly kind: ProviderKind;
  search(query: string, opts: SearchOptions): Promise<TrackCandidate[]>;
  getTrack(externalId: string, opts: SearchOptions): Promise<TrackCandidate | null>;
}

export interface PlaybackProvider {
  readonly kind: ProviderKind;
  /** All sources this provider can offer the viewer for the ref, best first. */
  sources(ref: TrackProviderRef, viewer: ViewerContext): PlaybackSource[];
}

/** Injected so adapters are testable and so we can add caching/telemetry centrally. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderKind,
    readonly status: number,
    message: string,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}
