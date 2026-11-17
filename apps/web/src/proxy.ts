import { type NextRequest, NextResponse } from "next/server";

/**
 * CORS for the Expo web build and other first-party origins. Native apps don't
 * need it. Only adds headers; authentication and authorization stay in the
 * route handlers (never in proxy/middleware).
 */
const allowed = new Set(
  (process.env.CORS_ORIGINS ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:8081"))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin");
  const ok = origin !== null && allowed.has(origin);
  if (req.method === "OPTIONS") {
    if (!ok) return new NextResponse(null, { status: 204 });
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }
  const res = NextResponse.next();
  if (ok) for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  return res;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-VYBZ-Apple-Music, X-VYBZ-Viewer",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export const config = { matcher: "/api/:path*" };
