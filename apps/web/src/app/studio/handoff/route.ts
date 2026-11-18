import { NextResponse } from "next/server";
import { getAuth, publicOrigin } from "@/server/context";

/**
 * The app opens DJ Studio in its in-app browser with a one-time token for its
 * session (single use, valid for a minute). This swaps it for the session
 * cookie, then goes to the studio page. Only studio and party paths are allowed next.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const raw = url.searchParams.get("next") ?? "/studio";
  const allowed = ["/studio", "/p/", "/p?", "/party"].some((p) => raw === p.replace(/[/?]$/, "") || raw.startsWith(p));
  const next = allowed && !raw.startsWith("//") && !raw.includes("\\") ? raw : "/studio";
  const res = NextResponse.redirect(new URL(next, publicOrigin()), 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  if (token && token.length < 200) {
    try {
      const { headers } = await getAuth().api.verifyOneTimeToken({ body: { token }, headers: req.headers, returnHeaders: true });
      for (const c of headers.getSetCookie()) res.headers.append("set-cookie", c);
    } catch {
      // Expired or used: the studio still opens, signed out.
    }
  }
  return res;
}
