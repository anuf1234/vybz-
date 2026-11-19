import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq, schema } from "@vybz/db";
import { getBattleDeps } from "@/server/context";
import { serverEnv } from "@/server/env";

/** Landing page for a shared drop: the release, where to listen, and the app. */
type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  const [r] = await getBattleDeps().db.select().from(schema.release).where(eq(schema.release.id, id));
  return r && r.status === "LIVE" ? r : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const r = await load(id);
  if (!r) return { title: "Daily Drops" };
  const title = `${r.title} by ${r.artistName}`;
  const image = { url: `/card/drop/${id}?format=wide`, width: 1200, height: 630 };
  return { title, description: "New on VYBZ Daily Drops.", openGraph: { title, description: "New on VYBZ Daily Drops.", images: [image] }, twitter: { card: "summary_large_image", images: [image.url] } };
}

export default async function DropLanding({ params }: Props) {
  const { id } = await params;
  const r = await load(id);
  if (!r) notFound();
  return (
    <section className="mx-auto max-w-md py-12 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Daily Drops</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {r.artworkUrl ? <img src={r.artworkUrl} alt="" className="mx-auto mt-6 aspect-square w-64 rounded-xl" /> : null}
      <h1 className="mt-6 font-display text-3xl font-bold">{r.title}</h1>
      <p className="mt-1 text-muted">{r.artistName}</p>
      <div className="mt-8 flex flex-col items-center gap-3">
        {r.externalUrl ? (
          <a href={r.externalUrl} className="inline-block rounded-xl border border-line px-6 py-3 font-bold" rel="noopener noreferrer">
            Listen ↗
          </a>
        ) : null}
        <a href={`${serverEnv().MOBILE_APP_SCHEME}://drops`} className="inline-block rounded-xl bg-violet px-6 py-3 font-bold text-white">
          See today&apos;s drops in VYBZ
        </a>
      </div>
    </section>
  );
}
