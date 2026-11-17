export * from "./types";
export * from "./resolver";
export * from "./matching";
export { AppleMusicAdapter, APPLE_GENRES, appleArtworkUrl, type AppleMusicAdapterConfig } from "./apple-music/adapter";
export {
  DeveloperTokenCache,
  signDeveloperToken,
  type AppleMusicKeyConfig,
  type DeveloperTokenOptions,
} from "./apple-music/developer-token";
export {
  YouTubeAdapter,
  cleanChannelName,
  parseIsoDuration,
  watchUrl,
  type YouTubeAdapterConfig,
} from "./youtube/adapter";
export { DemoCatalog, DEMO_TRACKS, type DemoCatalogConfig } from "./demo/adapter";
