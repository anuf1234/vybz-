import { resolvePlayback } from "@vybz/providers";
import { NextResponse, type NextRequest } from "next/server";
import { SearchQuerySchema, providerErrorStatus, searchCatalog } from "@/lib/catalog";
import { configured, defaultStorefront, registry } from "@/lib/providers";
import { guestViewer } from "@/lib/viewer";

export async function GET(req: NextRequest) {
  const parsed = SearchQuerySchema.safeParse({
    q: req.nextUrl.searchParams.get("q") ?? "",
    storefront: req.nextUrl.searchParams.get("storefront") ?? defaultStorefront,
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  if (!configured.appleMusic && !configured.youtube) {
    return NextResponse.json({ error: "no_providers_configured" }, { status: 503 });
  }

  const { q, storefront } = parsed.data;
  try {
    const items = await searchCatalog(q, storefront);
    // TODO(auth): use the signed-in viewer's connected providers once sessions exist.
    const viewer = guestViewer(storefront);
    return NextResponse.json({
      items: items.map((item) => ({ ...item, sources: resolvePlayback(item.refs, viewer, registry) })),
      providers: configured,
    });
  } catch (err) {
    console.error("catalog search failed", err);
    return NextResponse.json({ error: "provider_error" }, { status: providerErrorStatus(err) });
  }
}
