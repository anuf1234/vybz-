import type { Metadata } from "next";
import { configured } from "@/lib/providers";
import { CatalogSearch } from "@/components/catalog-search";

export const metadata: Metadata = { title: "Search music" };
// Provider availability comes from runtime env, not build-time env.
export const dynamic = "force-dynamic";

export default function SearchPage() {
  return (
    <div className="pt-8">
      <h1 className="font-display text-3xl font-bold uppercase">Pick your track</h1>
      <p className="mt-2 text-sm text-muted">
        Search Apple Music and YouTube. Everyone can hear a 30-second preview or the YouTube video, no account needed.
      </p>
      {!configured.appleMusic && !configured.youtube ? (
        <p className="mt-8 rounded-xl border border-line bg-surface-1 p-4 text-sm text-muted">
          No music providers are configured. Add Apple Music and YouTube keys to <code>.env.local</code> (see{" "}
          <code>.env.example</code>).
        </p>
      ) : (
        <CatalogSearch canMatchYouTube={configured.appleMusic && configured.youtube} />
      )}
    </div>
  );
}
