import "server-only";
import type { MetadataProvider, ProviderRegistry } from "@vybz/providers";
import { DemoCatalog } from "@vybz/providers";
import { apple, defaultStorefront, registry, youtube } from "@/lib/providers";
import { type AiJudge, AnthropicJudge, DemoJudge } from "./ai-judge";
import { type Auth, createAuth } from "./auth";
import type { BattleDeps } from "./battles/service";
import type { CatalogDeps } from "./catalog";
import { getDb } from "./db";
import { requireEnv, serverEnv } from "./env";
import { createMailer } from "./mailer";

/** Wires the services to this deployment's configuration. Built once per process. */

const g = globalThis as unknown as { __vybzAuth?: Auth; __vybzCatalog?: CatalogDeps };

export function publicOrigin(): string {
  return serverEnv().BETTER_AUTH_URL ?? "http://localhost:3000";
}

export function getCatalogDeps(): CatalogDeps {
  if (g.__vybzCatalog) return g.__vybzCatalog;
  const env = serverEnv();
  const demo = env.VYBZ_DEMO_CATALOG ? new DemoCatalog({ assetBaseUrl: publicOrigin() }) : null;
  const metadata: MetadataProvider[] = [apple, youtube, demo].filter((m): m is NonNullable<typeof m> => m !== null);
  // Demo catalog answers searches only when no real provider is configured.
  if (demo && (apple || youtube)) metadata.push(metadata.splice(metadata.indexOf(demo), 1)[0]!);
  const playback: ProviderRegistry = { ...registry, ...(demo ? { VYBZ_DEMO: demo } : {}) };
  g.__vybzCatalog = { metadata, playback, youtube: apple ? youtube : null, storefront: defaultStorefront };
  return g.__vybzCatalog;
}

/** Claude when a key is set; the demo stand-in only alongside the demo catalog; otherwise none. */
export function getAiJudge(): AiJudge | null {
  const env = serverEnv();
  if (env.ANTHROPIC_API_KEY) return new AnthropicJudge({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_JUDGE_MODEL });
  return env.VYBZ_DEMO_CATALOG ? new DemoJudge() : null;
}

export function getBattleDeps(): BattleDeps {
  return { db: getDb(), catalog: getCatalogDeps(), requireVerifiedEmail: serverEnv().AUTH_REQUIRE_EMAIL_VERIFICATION, aiJudge: getAiJudge() };
}

export function getAuth(): Auth {
  if (g.__vybzAuth) return g.__vybzAuth;
  const env = serverEnv();
  g.__vybzAuth = createAuth({
    db: getDb(),
    baseURL: publicOrigin(),
    secret: requireEnv("BETTER_AUTH_SECRET"),
    requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
    mailer: createMailer({ ...(env.RESEND_API_KEY ? { resendApiKey: env.RESEND_API_KEY } : {}), from: env.MAIL_FROM }),
    mobileScheme: env.MOBILE_APP_SCHEME,
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
    trustedOrigins: [
      ...(process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      // Development only: Expo Go and the Expo web dev server.
      ...(process.env.NODE_ENV === "production" ? [] : ["exp://", "exp://**", "exp://192.168.*.*:*/**", "http://localhost:8081"]),
    ],
  });
  return g.__vybzAuth;
}
