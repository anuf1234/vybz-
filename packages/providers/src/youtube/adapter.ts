import { z } from "zod";
import {
  type FetchLike,
  type MetadataProvider,
  type PlaybackProvider,
  type PlaybackSource,
  ProviderError,
  type SearchOptions,
  type TrackCandidate,
  type TrackProviderRef,
  type ViewerContext,
} from "../types";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const MUSIC_CATEGORY_ID = "10";

/**
 * Quota note: search.list costs 100 units, videos.list costs 1. The default
 * project quota is 10,000 units/day, so search results must be cached and
 * matching should happen once per track, not per viewer.
 */

const SearchResponseSchema = z.object({
  items: z.array(z.object({ id: z.object({ videoId: z.string().optional() }) })),
});

const VideoSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    channelTitle: z.string(),
    publishedAt: z.string().optional(),
    thumbnails: z.record(z.string(), z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() })).optional(),
  }),
  contentDetails: z.object({ duration: z.string() }).optional(),
  status: z.object({ embeddable: z.boolean().optional() }).optional(),
});
type Video = z.infer<typeof VideoSchema>;
const VideosResponseSchema = z.object({ items: z.array(VideoSchema) });

export interface YouTubeAdapterConfig {
  apiKey: string;
  fetch?: FetchLike;
}

export class YouTubeAdapter implements MetadataProvider, PlaybackProvider {
  readonly kind = "YOUTUBE" as const;
  private readonly fetchFn: FetchLike;

  constructor(private readonly config: YouTubeAdapterConfig) {
    this.fetchFn = config.fetch ?? fetch;
  }

  async search(query: string, opts: SearchOptions): Promise<TrackCandidate[]> {
    const q = query.trim();
    if (!q) return [];
    const params = new URLSearchParams({
      part: "id",
      type: "video",
      videoCategoryId: MUSIC_CATEGORY_ID,
      videoEmbeddable: "true",
      maxResults: String(Math.min(Math.max(opts.limit ?? 10, 1), 25)),
      regionCode: opts.storefront.toUpperCase(),
      q,
    });
    const json = await this.get(`/search?${params}`);
    const ids = SearchResponseSchema.parse(json)
      .items.map((i) => i.id.videoId)
      .filter((id): id is string => Boolean(id));
    // search.list snippets are HTML-escaped and lack duration/embeddable, so hydrate via videos.list (1 unit).
    return this.getVideos(ids);
  }

  async getTrack(externalId: string): Promise<TrackCandidate | null> {
    const [video] = await this.getVideos([externalId]);
    return video ?? null;
  }

  async getVideos(ids: string[]): Promise<TrackCandidate[]> {
    if (ids.length === 0) return [];
    const params = new URLSearchParams({
      part: "snippet,contentDetails,status",
      id: ids.slice(0, 50).join(","),
    });
    const json = await this.get(`/videos?${params}`);
    const byId = new Map(VideosResponseSchema.parse(json).items.map((v) => [v.id, toCandidate(v)]));
    // Preserve search ranking order.
    return ids.map((id) => byId.get(id)).filter((c): c is TrackCandidate => Boolean(c));
  }

  sources(ref: TrackProviderRef, _viewer: ViewerContext): PlaybackSource[] {
    const href = ref.externalUrl ?? watchUrl(ref.externalId);
    const attribution = { provider: this.kind, label: "YouTube", href };
    const out: PlaybackSource[] = [];
    if (ref.embeddable !== false) {
      out.push({
        tier: "EMBED",
        provider: this.kind,
        embed: { kind: "youtube", videoId: ref.externalId },
        attribution,
        // YouTube terms: the player stays visible; no audio-only extraction.
        restrictions: { mustShowPlayer: true, noOverlay: true },
      });
    }
    out.push({ tier: "LINK_OUT", provider: this.kind, href, attribution, restrictions: { noOverlay: true } });
    return out;
  }

  private async get(path: string): Promise<unknown> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await this.fetchFn(`${API_BASE}${path}${sep}key=${encodeURIComponent(this.config.apiKey)}`);
    if (!res.ok) throw new ProviderError(this.kind, res.status, `GET ${path.split("?")[0]} failed`);
    return res.json();
  }
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** Parses ISO 8601 durations as returned by YouTube, e.g. "PT3M45S", "PT1H2M", "P0D". */
export function parseIsoDuration(iso: string): number | undefined {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return undefined;
  const [, d, h, min, s] = m.map((v) => (v ? Number(v) : 0)) as number[];
  return ((((d ?? 0) * 24 + (h ?? 0)) * 60 + (min ?? 0)) * 60 + (s ?? 0)) * 1000;
}

/** Auto-generated artist channels are named "Artist - Topic". */
export function cleanChannelName(channelTitle: string): string {
  return channelTitle.replace(/\s+-\s+Topic$/i, "").replace(/VEVO$/i, "").trim();
}

function toCandidate(v: Video): TrackCandidate {
  const thumbs = v.snippet.thumbnails ?? {};
  const thumb = thumbs.maxres ?? thumbs.high ?? thumbs.medium ?? thumbs.default;
  const durationMs = v.contentDetails ? parseIsoDuration(v.contentDetails.duration) : undefined;
  const year = v.snippet.publishedAt ? Number.parseInt(v.snippet.publishedAt.slice(0, 4), 10) : undefined;
  return {
    provider: "YOUTUBE",
    externalId: v.id,
    title: v.snippet.title,
    artistName: cleanChannelName(v.snippet.channelTitle),
    ...(durationMs ? { durationMs } : {}),
    // Upload year, not release year; only used as a weak hint.
    ...(year && Number.isFinite(year) ? { releaseYear: year } : {}),
    ...(thumb ? { artwork: { url: thumb.url, width: thumb.width, height: thumb.height } } : {}),
    externalUrl: watchUrl(v.id),
    embeddable: v.status?.embeddable ?? true,
  };
}
