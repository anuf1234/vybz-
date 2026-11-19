import type { Metadata } from "next";
import Link from "next/link";
import { getBattleDeps } from "@/server/context";
import { serverEnv } from "@/server/env";
import { chart } from "@/server/verdict";

/**
 * The VYBZ Chart, public: this week's (live) or a past week's (final)
 * ranking of new releases by fans' This or That picks. /chart/current is
 * this week.
 */
type Props = { params: Promise<{ week: string }> };

const load = (week: string) => chart(getBattleDeps(), null, week === "current" ? null : week);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { week } = await params;
  const c = await load(week);
  const title = `The VYBZ Chart · ${c.label}`;
  const desc = c.rows[0] ? `#1: ${c.rows[0].release.title} by ${c.rows[0].release.artistName}. Ranked by fans.` : "New music, ranked by fans.";
  const image = { url: `/card/chart/${c.week}?format=wide`, width: 1200, height: 630 };
  return { title, description: desc, openGraph: { title, description: desc, images: [image] }, twitter: { card: "summary_large_image", images: [image.url] } };
}

export default async function ChartPage({ params }: Props) {
  const { week } = await params;
  const c = await load(week);
  return (
    <section className="mx-auto max-w-xl py-12">
      <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-muted">{c.final ? "Final" : "Live this week"}</p>
      <h1 className="mt-2 text-center font-display text-4xl font-bold">The VYBZ Chart</h1>
      <p className="mt-1 text-center text-violet-soft">{c.label}</p>
      <div className="mt-4 flex justify-center gap-4 text-sm">
        {c.prevWeek ? <Link href={`/chart/${c.prevWeek}`}>← Previous week</Link> : null}
        {c.nextWeek ? <Link href={`/chart/${c.nextWeek}`}>Next week →</Link> : null}
      </div>
      {c.rows.length ? (
        <ol className="mt-8 space-y-3">
          {c.rows.map((r) => (
            <li key={r.release.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
              <span className="w-8 text-right font-display text-xl font-bold">{r.rank}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.release.artworkUrl ? <img src={r.release.artworkUrl} alt="" className="h-12 w-12 rounded" /> : <span className="h-12 w-12 rounded bg-white/10" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{r.release.title}</span>
                <span className="block truncate text-sm text-muted">{r.release.artistName}</span>
              </span>
              <span className="text-right text-sm">
                <span className="block font-bold text-violet-soft">{r.score}%</span>
                <span className="block text-xs text-muted">{r.lastRank === null ? "new" : r.lastRank > r.rank ? `▲ ${r.lastRank - r.rank}` : r.lastRank < r.rank ? `▼ ${r.rank - r.lastRank}` : "="}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-10 text-center text-muted">No ranked releases yet. A release needs a few fan matchups to chart.</p>
      )}
      <div className="mt-10 text-center">
        <a href={`${serverEnv().MOBILE_APP_SCHEME}://chart`} className="inline-block rounded-xl bg-violet px-6 py-3 font-bold text-white">
          Vote in This or That on VYBZ
        </a>
        <p className="mt-3 text-xs text-muted">Each release&apos;s score is its share of fan matchups won, smoothed so a few votes don&apos;t swing it.</p>
      </div>
    </section>
  );
}
