import "server-only";
import {
  AppleMusicAdapter,
  DeveloperTokenCache,
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
});

// Empty strings in .env files mean "not set".
const env = EnvSchema.parse(
  Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
);

export const defaultStorefront = env.DEFAULT_STOREFRONT.toLowerCase();

/** Pasted ids often carry spaces, quotes or a "Key ID:" label; keep only the id. */
export function cleanAppleId(raw: string): string {
  return raw.replace(/^\s*(key\s*id|team\s*id)\s*[:=]?/i, "").replace(/["'\s]/g, "");
}

function buildApple(): AppleMusicAdapter | null {
  if (!env.APPLE_MUSIC_TEAM_ID || !env.APPLE_MUSIC_KEY_ID || !env.APPLE_MUSIC_PRIVATE_KEY) return null;
  const teamId = cleanAppleId(env.APPLE_MUSIC_TEAM_ID);
  const keyId = cleanAppleId(env.APPLE_MUSIC_KEY_ID);
  // Apple ids are 10 letters/digits. Report the shape, never the values.
  const shape = (v: string) => (/^[A-Z0-9]{10}$/.test(v) ? "ok" : `unexpected (${v.length} chars)`);
  console.info(`Apple Music configured: team id ${shape(teamId)}, key id ${shape(keyId)}`);
  const tokens = new DeveloperTokenCache(
    { teamId, keyId, privateKey: env.APPLE_MUSIC_PRIVATE_KEY },
    env.APP_ORIGIN ? { origins: [env.APP_ORIGIN] } : {},
  );
  // The iPhone app asks MusicKit for a Music User Token with a developer token that isn't tied to a web origin.
  const appTokens = new DeveloperTokenCache({ teamId, keyId, privateKey: env.APPLE_MUSIC_PRIVATE_KEY });
  appDeveloperToken = () => appTokens.get();
  return new AppleMusicAdapter({ developerToken: () => tokens.get() });
}

/** Developer token for the iPhone app's MusicKit user-token request. Null when Apple Music isn't set up. */
export let appDeveloperToken: (() => Promise<string>) | null = null;
export const apple = buildApple();
export const youtube = env.YOUTUBE_API_KEY ? new YouTubeAdapter({ apiKey: env.YOUTUBE_API_KEY }) : null;

export const registry: ProviderRegistry = {
  ...(apple ? { APPLE_MUSIC: apple } : {}),
  ...(youtube ? { YOUTUBE: youtube } : {}),
};

export const configured = { appleMusic: Boolean(apple), youtube: Boolean(youtube) };
