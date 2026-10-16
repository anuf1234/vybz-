import type { PrismaClient } from "@vybz/db";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { type SendEmail, resetPasswordEmail, verificationEmail } from "../email";

export interface AuthDeps {
  prisma: PrismaClient;
  sendEmail: SendEmail;
  baseURL: string;
  secret: string;
  google?: { clientId: string; clientSecret: string };
  /** Skip outbound calls (breached-password API): tests and offline development. */
  offline?: boolean;
  plugins?: BetterAuthPlugin[];
}

const DAY = 60 * 60 * 24;

/**
 * Framework-agnostic auth configuration, so it can be exercised in integration
 * tests against a real database. `lib/auth/server.ts` wires it into Next.js.
 */
export function createAuth(deps: AuthDeps) {
  return betterAuth({
    appName: "VYBZ",
    baseURL: deps.baseURL,
    secret: deps.secret,
    database: prismaAdapter(deps.prisma, { provider: "postgresql" }),
    telemetry: { enabled: false },

    emailAndPassword: {
      enabled: true,
      // Unverified accounts can't sign in, so every account has a reachable email.
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await deps.sendEmail({ to: user.email, ...resetPasswordEmail(url) });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true, // re-send if they try to sign in before verifying
      autoSignInAfterVerification: true,
      expiresIn: DAY,
      sendVerificationEmail: async ({ user, url }) => {
        await deps.sendEmail({ to: user.email, ...verificationEmail(url) });
      },
    },

    ...(deps.google
      ? {
          socialProviders: {
            google: {
              clientId: deps.google.clientId,
              clientSecret: deps.google.clientSecret,
              prompt: "select_account" as const,
            },
          },
        }
      : {}),

    account: {
      accountLinking: {
        enabled: true,
        // Google asserts verified emails, so a Google sign-in may attach to an
        // existing email/password account with the same address. Nothing else may.
        trustedProviders: ["google"],
      },
    },

    user: {
      // Account controls live on the user row and can't be set through auth
      // endpoints. Public identity (username, bio) is the Profile table, written
      // only by validated server actions.
      additionalFields: {
        role: { type: "string", required: false, input: false, defaultValue: "USER" },
        status: { type: "string", required: false, input: false, defaultValue: "ACTIVE" },
        trustScore: { type: "number", required: false, input: false, defaultValue: 50, returned: false },
      },
    },

    session: {
      expiresIn: 30 * DAY,
      updateAge: DAY, // sliding expiry, refreshed at most daily
      // No cookie cache: every request checks the session row, so sign-out,
      // password resets and bans take effect immediately. Revisit with Redis
      // secondary storage if session lookups ever show up in latency.
      cookieCache: { enabled: false },
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60 * 60, max: 5 },
        "/request-password-reset": { window: 60 * 60, max: 5 },
        "/send-verification-email": { window: 60 * 60, max: 5 },
      },
    },

    advanced: {
      cookiePrefix: "vybz",
      useSecureCookies: deps.baseURL.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },

    databaseHooks: {
      session: {
        create: {
          // Banned accounts can't start new sessions, whatever the login method.
          before: async (session) => {
            const user = await deps.prisma.user.findUnique({
              where: { id: session.userId },
              select: { status: true },
            });
            if (user?.status === "BANNED") {
              throw new APIError("FORBIDDEN", { message: "This account has been banned.", code: "ACCOUNT_BANNED" });
            }
          },
        },
      },
    },

    // Profile edits and account deletion go through our own validated server
    // actions, so the generic auth endpoints for them are switched off.
    disabledPaths: ["/update-user", "/change-email", "/delete-user", "/delete-user/callback"],

    plugins: [...(deps.offline ? [] : [haveIBeenPwned()]), ...(deps.plugins ?? [])],
  });
}

export type Auth = ReturnType<typeof createAuth>;
