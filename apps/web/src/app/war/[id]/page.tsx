import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBattleDeps } from "@/server/context";
import { serverEnv } from "@/server/env";
import { getWar } from "@/server/wars";

/** Landing page for shared war links: the matchup (and result), opening the war in the app. */
type Props = { params: Promise<{ id: string }> };

const load = (id: string) => getWar(getBattleDeps(), null, id).catch(() => null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const w = await load(id);
  if (!w) return { title: "Album war" };
  const desc = w.status === "CLOSED" ? `${w.voters} fans voted. See who won on VYBZ.` : "Two releases, head to head. Vote on VYBZ.";
  const image = { url: `/card/war/${id}?format=wide`, width: 1200, height: 630 };
  return { title: w.title, description: desc, openGraph: { title: w.title, description: desc, images: [image] }, twitter: { card: "summary_large_image", images: [image.url] } };
}

export default async function WarLanding({ params }: Props) {
  const { id } = await params;
  const w = await load(id);
  if (!w) notFound();
  const deepLink = `${serverEnv().MOBILE_APP_SCHEME}://wars/${encodeURIComponent(id)}`;
  const overall = w.categories.find((c) => c.key === "overall");
  const side = (s: "A" | "B") => {
    const x = s === "A" ? w.a : w.b;
    const n = overall ? (s === "A" ? overall.a : overall.b) : null;
    return (
      <div className={`flex-1 rounded-xl border p-3 text-center ${w.winner === s ? "border-violet" : "border-line"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {x.artworkUrl ? <img src={x.artworkUrl} alt="" className="mx-auto aspect-square w-full rounded-lg" /> : <div className="aspect-square w-full rounded-lg bg-white/10" />}
        <p className="mt-2 font-bold">{x.title}</p>
        <p className="text-sm text-muted">{x.artistName}</p>
        {w.status === "CLOSED" && n !== null ? <p className="mt-1 font-display text-2xl font-bold">{n}</p> : null}
      </div>
    );
  };
  return (
    <section className="mx-auto max-w-md py-12">
      <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-muted">{w.kind === "ALBUM" ? "Album war" : "Single war"}</p>
      <h1 className="mt-3 text-center font-display text-3xl font-bold">{w.title}</h1>
      <div className="mt-6 flex items-center gap-3">
        {side("A")}
        <span className="font-bold text-muted">VS</span>
        {side("B")}
      </div>
      <p className="mt-4 text-center text-sm text-muted">{w.voters} voters</p>
      <div className="mt-8 text-center">
        <a href={deepLink} className="inline-block rounded-xl bg-violet px-6 py-3 font-bold text-white">
          {w.status === "CLOSED" ? "See it in the VYBZ app" : "Vote in the VYBZ app"}
        </a>
      </div>
    </section>
  );
}
