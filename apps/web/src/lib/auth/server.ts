import "server-only";
import type { Actor, Role, UserStatus } from "@vybz/core";
import { prisma } from "@vybz/db";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { createEmailSender } from "../email";
import { createAuth } from "./config";

const Env = z.object({
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  VERCEL_ENV: z.string().optional(),
  /** For offline local development only; ignored on the production deployment. */
  SKIP_BREACHED_PASSWORD_CHECK: z.literal("1").optional(),
});

function readEnv() {
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  // `next build` imports this module without runtime secrets; use inert values there.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return Env.parse({ ...raw, BETTER_AUTH_SECRET: "x".repeat(32), BETTER_AUTH_URL: "http://localhost:3000" });
  }
  return Env.parse(raw);
}

const env = readEnv();

export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const auth = createAuth({
  prisma,
  sendEmail: createEmailSender(env),
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  offline: env.SKIP_BREACHED_PASSWORD_CHECK === "1" && env.VERCEL_ENV !== "production",
  ...(googleEnabled ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } } : {}),
  // Must be last: lets server actions set auth cookies.
  plugins: [nextCookies()],
});

/** The signed-in user for this request, or null. Deduplicated per render. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** The current user as the policy layer sees them, or null for guests. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await getSession();
  if (!session) return null;
  const u = session.user;
  const profile = await prisma.profile.findUnique({ where: { userId: u.id }, select: { username: true } });
  return {
    id: u.id,
    role: u.role as Role,
    status: u.status as UserStatus,
    emailVerified: u.emailVerified,
    handle: profile?.username ?? null,
  };
});

/** Only same-site relative paths, so `?next=` can't redirect off-site. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** For pages that need a signed-in, onboarded user. `next` is where to return after signing in. */
export async function requireActor(opts: { allowMissingHandle?: boolean; next?: string } = {}): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect(opts.next ? `/login?next=${encodeURIComponent(safeNext(opts.next))}` : "/login");
  if (!actor.handle && !opts.allowMissingHandle) {
    redirect(opts.next ? `/onboarding?next=${encodeURIComponent(safeNext(opts.next))}` : "/onboarding");
  }
  return actor;
}
