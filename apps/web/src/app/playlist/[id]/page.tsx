import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NO_CAPS, viewerContext } from "@/server/catalog";
import { getBattleDeps } from "@/server/context";
import { serverEnv } from "@/server/env";
import { getPlaylist } from "@/server/library";

/**
 * Landing page for shared playlist links (/playlist/<id>?code=…). Shows the
 * songs and opens the playlist in the VYBZ app; private playlists need the code.
 */

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ code?: string }> };

async function load(id: string, code: string | undefined) {
  const deps = getBattleDeps();
  try {
    return await getPlaylist(deps, null, id, code ?? null, viewerContext(deps.catalog.storefront, NO_CAPS));
  } catch {
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, { code }] = await Promise.all([params, searchParams]);
  const p = await load(id, code);
  if (!p) return { title: "Playlist" };
  const desc = `${p.trackCount} songs by @${p.owner.handle} on VYBZ.`;
  return { title: p.title, description: desc, openGraph: { title: p.title, description: desc }, robots: p.visibility === "PRIVATE" ? { index: false } : undefined };
}

export default async function PlaylistLanding({ params, searchParams }: Props) {
  const [{ id }, { code }] = await Promise.all([params, searchParams]);
  const p = await load(id, code);
  if (!p) notFound();
  const deepLink = `${serverEnv().MOBILE_APP_SCHEME}://playlist/${encodeURIComponent(id)}${code ? `?code=${encodeURIComponent(code)}` : ""}`;
  return (
    <section className="mx-auto max-w-md py-16">
      <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-muted">Playlist · @{p.owner.handle}</p>
      <h1 className="mt-3 text-center font-display text-4xl font-bold">{p.title}</h1>
      {p.description ? <p className="mt-2 text-center text-muted">{p.description}</p> : null}
      <div className="mt-8 text-center">
        <a href={deepLink} className="inline-block rounded-xl bg-violet px-6 py-3 font-bold text-white">
          Open in the VYBZ app
        </a>
      </div>
      <ol className="mt-10 space-y-2">
        {p.tracks.slice(0, 50).map((t, i) => (
          <li key={t.trackId} className="flex items-center gap-3 text-sm">
            <span className="w-6 text-right text-muted">{i + 1}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.artworkUrl ? <img src={t.artworkUrl} alt="" className="h-10 w-10 rounded" /> : <span className="h-10 w-10 rounded bg-white/10" />}
            <span className="min-w-0">
              <span className="block truncate font-bold">{t.title}</span>
              <span className="block truncate text-muted">
                {t.artistName}
                {t.releaseYear ? ` · ${t.releaseYear}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
