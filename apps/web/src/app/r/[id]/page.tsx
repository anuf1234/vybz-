import { battleResultSummary } from "@vybz/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { serverEnv } from "@/server/env";

/**
 * A shared battle result with a dare: https://…/r/<battle id>?by=<handle>.
 * The link preview is the result card; the button opens the app on a
 * rematch screen that challenges whoever shared it.
 */
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ by?: string; code?: string }> };

const clean = (v: string | undefined, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

async function load(id: string, code: string | undefined) {
  try {
    const b = await getBattleView(getBattleDeps(), null, id, undefined, code ?? null);
    return b.status === "COMPLETE" ? b : null;
  } catch {
    return null;
  }
}

function query(by: string | undefined, code: string | undefined) {
  const q = new URLSearchParams();
  if (by) q.set("by", by);
  if (code) q.set("code", code);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const by = clean(sp.by, 40);
  const code = clean(sp.code, 64);
  const b = await load(id, code);
  if (!b) return { title: "Battle result" };
  const s = battleResultSummary(b, by);
  const cardQuery = new URLSearchParams({ format: "wide", ...(by ? { as: by } : {}), ...(code ? { code } : {}) });
  const image = { url: `/card/result/${encodeURIComponent(id)}?${cardQuery}`, width: 1200, height: 630 };
  const title = s.headline;
  return {
    title,
    description: `${s.callToAction} Battle on VYBZ.`,
    openGraph: { title, description: s.callToAction, images: [image] },
    twitter: { card: "summary_large_image", images: [image.url] },
    robots: { index: false },
  };
}

export default async function ResultLanding({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const by = clean(sp.by, 40);
  const code = clean(sp.code, 64);
  const b = await load(id, code);
  if (!b) notFound();
  const s = battleResultSummary(b, by);
  const scheme = serverEnv().MOBILE_APP_SCHEME;
  const deepLink = `${scheme}://rematch/${encodeURIComponent(id)}${query(s.challengeHandle ?? undefined, code)}`;
  const cardQuery = new URLSearchParams({ format: "story", ...(by ? { as: by } : {}), ...(code ? { code } : {}) });

  return (
    <section className="mx-auto max-w-md py-10 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">{s.theme}</p>
      <h1 className="mt-3 font-display text-3xl font-bold">{s.headline}</h1>
      {s.score ? <p className="mt-2 font-display text-5xl font-bold text-violet-soft">{s.score}</p> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/card/result/${encodeURIComponent(id)}?${cardQuery}`} alt={s.headline} className="mx-auto mt-6 w-64 rounded-2xl border border-line" />
      <div className="mt-8">
        <a href={deepLink} className="inline-block rounded-xl bg-violet px-6 py-3 font-bold text-white">
          {s.challengeHandle ? `Take on @${s.challengeHandle}` : "Battle on VYBZ"}
        </a>
        <p className="mt-3 text-sm text-muted">{s.callToAction}</p>
        <p className="mt-3 text-xs text-muted">Don&apos;t have the app yet? It&apos;s in testing; ask whoever sent you this link for an invite.</p>
      </div>
      <p className="mt-8 text-sm">
        <a href={`/battle/${encodeURIComponent(id)}${code ? `?code=${encodeURIComponent(code)}` : ""}`} className="text-violet-soft underline">
          See every round
        </a>
      </p>
    </section>
  );
}
