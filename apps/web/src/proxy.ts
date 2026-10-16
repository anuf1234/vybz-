import { type NextRequest, NextResponse } from "next/server";

/**
 * Fast redirect for signed-out visitors on pages that need an account, so
 * they land on the login page with a way back. This only checks that a
 * session cookie exists; every page and action still verifies the session
 * and permissions on the server.
 */
const PROTECTED = ["/battle/create", "/battles/my", "/settings", "/onboarding", "/notifications"];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const hasSession = req.cookies.getAll().some((c) => c.name.endsWith("vybz.session_token"));
  if (hasSession) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/battle/create/:path*", "/battles/my/:path*", "/settings/:path*", "/onboarding/:path*", "/notifications/:path*"],
};
