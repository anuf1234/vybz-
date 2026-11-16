import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .default(fallback);

const isProd = process.env.NODE_ENV === "production";

const ServerEnvSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  /** Public origin of this deployment, e.g. https://urexp.com */
  BETTER_AUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).default("VYBZ <noreply@mail.urexp.com>"),
  AUTH_REQUIRE_EMAIL_VERIFICATION: bool(isProd),
  /** Built-in synthesized demo catalog. Refused in production. */
  VYBZ_DEMO_CATALOG: bool(false),
  /** Enables the AI judge (Claude). */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_JUDGE_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  /** Shared secret for the scheduler hitting /api/cron/advance. */
  CRON_SECRET: z.string().min(16).optional(),
  /** Deep-link scheme of the mobile app, for auth redirects. */
  MOBILE_APP_SCHEME: z.string().regex(/^[a-z][a-z0-9+.-]*$/).default("vybz"),
});

export type ServerEnv = z.output<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const env = ServerEnvSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));
  if (env.VYBZ_DEMO_CATALOG && isProductionDeployment(env)) throw new Error("VYBZ_DEMO_CATALOG must not be enabled in production");
  cached = env;
  return env;
}

export function requireEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const v = serverEnv()[key];
  if (v === undefined || v === null) throw new Error(`${String(key)} is not set`);
  return v as NonNullable<ServerEnv[K]>;
}

/** The live site, as opposed to local `next start`, previews or staging. */
function isProductionDeployment(env: ServerEnv): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  const host = env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL).hostname : "";
  return host === "urexp.com" || host === "www.urexp.com";
}
