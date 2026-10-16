export * from "./types";
export * from "./resolver";
export * from "./matching";
export { AppleMusicAdapter, appleArtworkUrl, type AppleMusicAdapterConfig } from "./apple-music/adapter";
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
export { FIXTURE_TRACKS, FixtureMusicAdapter } from "./fixture/adapter";
