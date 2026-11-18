import { expo } from "@better-auth/expo";
import { HandleSchema, suggestHandle } from "@vybz/core";
import { type Database, newId, schema, eq } from "@vybz/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Mailer } from "./mailer";

export interface AuthConfig {
  db: Database;
  baseURL: string;
  secret: string;
  requireEmailVerification: boolean;
  mailer: Mailer;
  mobileScheme: string;
  google?: { clientId: string; clientSecret: string };
  facebook?: { clientId: string; clientSecret: string };
  tiktok?: { clientKey: string; clientSecret: string };
  /** Native Sign in with Apple: ID tokens from the app, checked against this bundle ID. */
  apple?: { bundleId: string };
  /** Extra trusted origins (e.g. Expo dev servers). */
  trustedOrigins?: string[];
  /** Turn off Better Auth's limiter (tests hammer the endpoints). */
  disableRateLimit?: boolean;
}

/**
 * Better Auth: email/password plus Google, Facebook, TikTok and Apple, database sessions in our Postgres.
 * The Expo plugin lets the mobile app sign in with the same sessions: it stores
 * the session cookie in SecureStore and sends it on each request.
 */
export function createAuth(cfg: AuthConfig) {
  return betterAuth({
    appName: "VYBZ",
    baseURL: cfg.baseURL,
    secret: cfg.secret,
    database: drizzleAdapter(cfg.db, {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    telemetry: { enabled: false },
    trustedOrigins: [`${cfg.mobileScheme}://`, ...(cfg.trustedOrigins ?? [])],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: cfg.requireEmailVerification,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await cfg.mailer({
          to: user.email,
          subject: "Reset your VYBZ password",
          text: `Reset your password: ${url}\n\nThis link expires in 1 hour. If you didn't ask for this, ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await cfg.mailer({
          to: user.email,
          subject: "Verify your email for VYBZ",
          text: `Confirm your email to start battling and voting: ${url}`,
        });
      },
    },
    socialProviders: {
      ...(cfg.google ? { google: { clientId: cfg.google.clientId, clientSecret: cfg.google.clientSecret } } : {}),
      ...(cfg.facebook ? { facebook: { clientId: cfg.facebook.clientId, clientSecret: cfg.facebook.clientSecret } } : {}),
      ...(cfg.tiktok ? { tiktok: { clientKey: cfg.tiktok.clientKey, clientSecret: cfg.tiktok.clientSecret } } : {}),
      // Only the app's native sheet is used, which sends an ID token; the web redirect flow
      // (which would need an Apple client secret) isn't offered.
      ...(cfg.apple ? { apple: { clientId: cfg.apple.bundleId, appBundleIdentifier: cfg.apple.bundleId, clientSecret: "native-id-token-only" } } : {}),
    },
    // Emails Google and Apple have verified can join an existing VYBZ account with the same email.
    account: { accountLinking: { enabled: true, trustedProviders: ["google", "apple"] } },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: true, maxAge: 5 * 60 } },
    user: {
      additionalFields: {
        // Optional at sign-up; generated from the email when missing.
        handle: { type: "string", required: false, input: true },
        role: { type: "string", required: false, input: false, defaultValue: "USER" },
        status: { type: "string", required: false, input: false, defaultValue: "ACTIVE" },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const requested = typeof user.handle === "string" && user.handle ? HandleSchema.safeParse(user.handle) : null;
            if (requested && !requested.success) return false;
            const handle = await uniqueHandle(cfg.db, requested?.data ?? suggestHandle(user.email), Boolean(requested));
            if (!handle) return false;
            return { data: { ...user, handle, role: "USER", status: "ACTIVE" } };
          },
        },
      },
      session: {
        create: {
          // Suspended and banned accounts can't start sessions.
          before: async (session) => {
            const [row] = await cfg.db
              .select({ status: schema.user.status })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId));
            return row?.status === "ACTIVE";
          },
        },
      },
    },
    rateLimit: { enabled: !cfg.disableRateLimit, window: 60, max: 100, customRules: { "/sign-in/email": { window: 60, max: 5 }, "/sign-up/email": { window: 3600, max: 10 } } },
    advanced: {
      database: { generateId: () => newId() },
      cookiePrefix: "vybz",
      useSecureCookies: cfg.baseURL.startsWith("https://"),
      // On Render, requests arrive through Cloudflare, which sets the client's address in
      // headers clients can't forge; elsewhere, don't trust forwarding headers.
      ...(process.env.RENDER ? { ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "true-client-ip", "x-forwarded-for"] } } : {}),
    },
    plugins: [expo()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * A free handle based on `base`. When the person asked for this exact handle,
 * returns null if it's taken instead of picking a variant.
 */
async function uniqueHandle(db: Database, base: string, exact: boolean): Promise<string | null> {
  const taken = async (h: string) =>
    (await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.handle, h)).limit(1)).length > 0;
  if (!(await taken(base))) return base;
  if (exact) return null;
  for (let i = 0; i < 20; i++) {
    const candidate = `${base.slice(0, 15)}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${base.slice(0, 10)}${newId().slice(-8)}`;
}
