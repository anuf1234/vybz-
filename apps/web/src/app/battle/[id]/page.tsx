import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { serverEnv } from "@/server/env";

/**
 * Landing page for shared battle links (https://urexp.com/battle/<id>?code=…).
 * Opens the battle in the VYBZ app; private battles need the invite code.
 */

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ code?: string }> };

async function load(id: string, code: string | undefined) {
  try {
    return await getBattleView(getBattleDeps(), null, id, undefined, code ?? null);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, { code }] = await Promise.all([params, searchParams]);
  const b = await load(id, code);
  if (!b) return { title: "Battle" };
  const desc = `${b.theme ?? "Music battle"} · ${b.rounds.length} rounds · the crowd decides.`;
  return { title: b.title, description: desc, openGraph: { title: b.title, description: desc }, robots: b.visibility === "PRIVATE" ? { index: false } : undefined };
}

export default async function BattleLanding({ params, searchParams }: Props) {
  const [{ id }, { code }] = await Promise.all([params, searchParams]);
  const b = await load(id, code);
  if (!b) notFound();
  const scheme = serverEnv().MOBILE_APP_SCHEME;
  const deepLink = `${scheme}://battle/${encodeURIComponent(id)}${code ? `?code=${encodeURIComponent(code)}` : ""}`;
  const players = b.participants.map((p) => `@${p.user.handle}`);

  return (
    <section className="mx-auto max-w-md py-16 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">{b.format === "MULTI" ? `Battle · up to ${b.entrants.max} players` : "Duel"}</p>
      <h1 className="mt-3 font-display text-4xl font-bold">{b.title}</h1>
      {b.theme ? <p className="mt-2 text-muted">{b.theme}</p> : null}
      <p className="mt-6 text-sm text-muted">
        {players.length ? players.join(" vs ") : `Hosted by @${b.creator.handle}`} · {b.rounds.length} rounds
      </p>
      <a href={deepLink} className="mt-10 inline-block rounded-xl bg-violet px-6 py-3 font-bold text-white">
        Open in the VYBZ app
      </a>
      <p className="mt-4 text-xs text-muted">Don&apos;t have the app yet? It&apos;s in testing; ask whoever sent you this link for an invite.</p>
    </section>
  );
}
