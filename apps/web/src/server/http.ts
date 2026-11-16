import "server-only";
import { schema, eq } from "@vybz/db";
import { NextResponse, after } from "next/server";
import { ServiceError, type UserRow } from "./battles/service";
import type { PlaybackCaps } from "./catalog";
import { getAuth, publicOrigin } from "./context";
import { getDb } from "./db";

/** The signed-in user for this request (cookie or the mobile app's cookie header), or null. */
export async function currentUser(req: Request): Promise<UserRow | null> {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session) return null;
  const [row] = await getDb().select().from(schema.user).where(eq(schema.user.id, session.user.id));
  return row ?? null;
}

/**
 * CSRF guard for mutations: browsers always send Origin on cross-site POSTs,
 * so a present Origin must be ours. Native apps send none.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const allowed = new Set([publicOrigin(), new URL(req.url).origin]);
  for (const o of (process.env.CORS_ORIGINS ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:8081")).split(",")) {
    if (o.trim()) allowed.add(o.trim());
  }
  if (!allowed.has(origin)) throw new ServiceError(403, "BAD_ORIGIN");
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 16_384) throw new ServiceError(413, "PAYLOAD_TOO_LARGE");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ServiceError(400, "INVALID_JSON");
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.code, message: err.message !== err.code ? err.message : undefined }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
}

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

/** Wraps a route handler with error mapping and, for mutations, the origin check. */
export function route<P = Record<string, never>>(fn: Handler<P>, opts: { mutation?: boolean } = {}): Handler<P> {
  return async (req, ctx) => {
    try {
      if (opts.mutation) assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function parseRoundIndex(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 20) throw new ServiceError(400, "INVALID_ROUND");
  return n;
}

export const noStore = { headers: { "Cache-Control": "no-store" } };

/**
 * Runs work after the response is sent (Next's `after`). Outside a request
 * scope (scripts, tests) it runs right away instead.
 */
export function background(fn: () => Promise<unknown>): void {
  const run = () => fn().catch((err) => console.error("background task failed", err));
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Playback capabilities the app reports for this device. The mobile app sends
 * `X-VYBZ-Apple-Music: full` once MusicKit confirms an Apple Music subscription.
 */
export function playbackCaps(req: Request): PlaybackCaps {
  return { appleMusicFull: req.headers.get("x-vybz-apple-music") === "full" };
}
