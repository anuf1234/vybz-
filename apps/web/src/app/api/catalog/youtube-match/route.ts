import { resolvePlayback } from "@vybz/providers";
import { NextResponse, type NextRequest } from "next/server";
import { MatchQuerySchema, matchYouTube, providerErrorStatus } from "@/lib/catalog";
import { configured, defaultStorefront, registry } from "@/lib/providers";
import { guestViewer } from "@/lib/viewer";

/** Finds the YouTube video for an Apple Music song. Costs ~101 quota units on a cache miss. */
export async function GET(req: NextRequest) {
  const parsed = MatchQuerySchema.safeParse({
    appleId: req.nextUrl.searchParams.get("appleId") ?? "",
    storefront: req.nextUrl.searchParams.get("storefront") ?? defaultStorefront,
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  if (!configured.appleMusic || !configured.youtube) {
    return NextResponse.json({ error: "no_providers_configured" }, { status: 503 });
  }

  const { appleId, storefront } = parsed.data;
  try {
    const ref = await matchYouTube(appleId, storefront);
    if (!ref) return NextResponse.json({ match: null });
    return NextResponse.json({ match: ref, sources: resolvePlayback([ref], guestViewer(storefront), registry) });
  } catch (err) {
    console.error("youtube match failed", err);
    return NextResponse.json({ error: "provider_error" }, { status: providerErrorStatus(err) });
  }
}
