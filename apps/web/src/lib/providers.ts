import "server-only";
import {
  AppleMusicAdapter,
  DeveloperTokenCache,
  FixtureMusicAdapter,
  type MetadataProvider,
  type PlaybackProvider,
  type ProviderRegistry,
  YouTubeAdapter,
} from "@vybz/providers";
import { z } from "zod";

const EnvSchema = z.object({
  APPLE_MUSIC_TEAM_ID: z.string().min(1).optional(),
  APPLE_MUSIC_KEY_ID: z.string().min(1).optional(),
  APPLE_MUSIC_PRIVATE_KEY: z.string().min(1).optional(),
  YOUTUBE_API_KEY: z.string().min(1).optional(),
  DEFAULT_STOREFRONT: z
    .string()
    .regex(/^[a-zA-Z]{2}$/)
    .default("us"),
  APP_ORIGIN: z.string().url().optional(),
  /** Development only: sample catalog with generated tones when Apple Music isn't configured. */
  MUSIC_FIXTURES: z.literal("1").optional(),
  VERCEL_ENV: z.string().optional(),
});

// Empty strings in .env files mean "not set".
const env = EnvSchema.parse(
  Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
);

export const defaultStorefront = env.DEFAULT_STOREFRONT.toLowerCase();

type CatalogProvider = MetadataProvider & PlaybackProvider;

function buildApple(): CatalogProvider | null {
  if (env.APPLE_MUSIC_TEAM_ID && env.APPLE_MUSIC_KEY_ID && env.APPLE_MUSIC_PRIVATE_KEY) {
    const tokens = new DeveloperTokenCache(
      { teamId: env.APPLE_MUSIC_TEAM_ID, keyId: env.APPLE_MUSIC_KEY_ID, privateKey: env.APPLE_MUSIC_PRIVATE_KEY },
      env.APP_ORIGIN ? { origins: [env.APP_ORIGIN] } : {},
    );
    return new AppleMusicAdapter({ developerToken: () => tokens.get() });
  }
  if (fixturesEnabled) return new FixtureMusicAdapter("/api/dev/tone");
  return null;
}

/** Sample catalog mode. Never on the production deployment, and never alongside a real Apple Music key. */
export const fixturesEnabled =
  env.MUSIC_FIXTURES === "1" && env.VERCEL_ENV !== "production" && !env.APPLE_MUSIC_PRIVATE_KEY;

export const apple = buildApple();
export const youtube = env.YOUTUBE_API_KEY ? new YouTubeAdapter({ apiKey: env.YOUTUBE_API_KEY }) : null;

export const registry: ProviderRegistry = {
  ...(apple ? { APPLE_MUSIC: apple } : {}),
  ...(youtube ? { YOUTUBE: youtube } : {}),
};

export const configured = { appleMusic: Boolean(apple), youtube: Boolean(youtube), fixtures: fixturesEnabled };
