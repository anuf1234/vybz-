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
  const score = b.participants.map((p) => `@${p.user.handle} ${p.roundsWon}`).join(" · ");
  const desc = b.status === "COMPLETE" || b.status === "IN_PROGRESS" ? `${score} · ${b.theme ?? "Music battle"} on VYBZ` : `${b.theme ?? "Music battle"} · ${b.rounds.length} rounds · listen to every pick, then vote.`;
  return { title: b.title, description: desc, openGraph: { title: b.title, description: desc }, robots: b.visibility === "PRIVATE" ? { index: false } : undefined };
}

export default async function BattleLanding({ params, searchParams }: Props) {
  const [{ id }, { code }] = await Promise.all([params, searchParams]);
  const b = await load(id, code);
  if (!b) notFound();
  const scheme = serverEnv().MOBILE_APP_SCHEME;
  const deepLink = `${scheme}://battle/${encodeURIComponent(id)}${code ? `?code=${encodeURIComponent(code)}` : ""}`;
  const players = [...b.participants].sort((x, y) => y.roundsWon - x.roundsWon || x.side - y.side);
  const handleOf = (pid: string | null) => b.participants.find((p) => p.id === pid)?.user.handle ?? null;
  const winner = handleOf(b.winnerParticipantId);
  const scored = b.rounds.filter((r) => r.status === "SCORED" && r.entries.some((e) => e.participantId));
  const live = b.status === "IN_PROGRESS" ? b.rounds.find((r) => r.status !== "SCORED") : undefined;
  const cta =
    b.status === "COMPLETE"
      ? "See it in the VYBZ app"
      : b.status === "IN_PROGRESS"
        ? live?.status === "VOTING_OPEN"
          ? "Listen and vote in the app"
          : "Follow it in the app"
        : b.format === "DUEL"
          ? "Take this challenge in the app"
          : "Join in the app";

  return (
    <section className="mx-auto max-w-md py-12">
      <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-muted">{b.format === "MULTI" ? `Battle · up to ${b.entrants.max} players` : "Duel"}</p>
      <h1 className="mt-3 text-center font-display text-4xl font-bold">{b.title}</h1>
      {b.theme ? <p className="mt-2 text-center text-muted">{b.theme}</p> : null}

      <p className="mt-6 text-center text-sm font-bold text-violet-soft">
        {b.status === "COMPLETE"
          ? winner
            ? `@${winner} wins`
            : "Ended level"
          : live
            ? `Live · round ${live.index + 1} of ${b.rounds.length} · ${live.status === "VOTING_OPEN" ? "voting now" : "picking"}`
            : b.status === "OPEN_CHALLENGE"
              ? "Open: anyone can take it"
              : `${b.rounds.length} rounds`}
      </p>

      {players.length ? (
        <ul className="mt-6 space-y-2">
          {players.map((p) => (
            <li key={p.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${p.id === b.winnerParticipantId ? "border-violet" : "border-line"}`}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 font-bold">{(p.user.displayName || p.user.handle).slice(0, 1).toUpperCase()}</span>
              <span className="flex-1 font-bold">@{p.user.handle}</span>
              {b.status !== "OPEN_CHALLENGE" ? <span className="font-display text-2xl font-bold">{p.roundsWon}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-center text-sm text-muted">Hosted by @{b.creator.handle}</p>
      )}

      <div className="mt-8 text-center">
        <a href={deepLink} className="inline-block rounded-xl bg-violet px-6 py-3 font-bold text-white">
          {cta}
        </a>
        <p className="mt-3 text-xs text-muted">Don&apos;t have the app yet? It&apos;s in testing; ask whoever sent you this link for an invite.</p>
      </div>

      {scored.length ? (
        <div className="mt-10 space-y-6">
          {scored.map((r) => (
            <div key={r.index}>
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-muted">
                Round {r.index + 1}
                {r.winnerParticipantId ? ` · @${handleOf(r.winnerParticipantId)}` : " · draw"}
              </h2>
              <ul className="mt-2 space-y-2">
                {r.entries.flatMap((e) =>
                  e.tracks.map((t) => (
                    <li key={t.submissionId} className="flex items-center gap-3 text-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {t.track.artworkUrl ? <img src={t.track.artworkUrl} alt="" className="h-10 w-10 rounded" /> : <span className="h-10 w-10 rounded bg-white/10" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{t.track.title}</span>
                        <span className="block truncate text-muted">
                          {t.track.artistName}
                          {t.track.releaseYear ? ` · ${t.track.releaseYear}` : ""}
                        </span>
                      </span>
                      <span className={`text-xs font-bold ${e.participantId === r.winnerParticipantId ? "text-violet-soft" : "text-muted"}`}>
                        @{handleOf(e.participantId)}
                        {e.participantId === r.winnerParticipantId ? " ✓" : ""}
                      </span>
                    </li>
                  )),
                )}
              </ul>
              {r.ai ? <p className="mt-2 text-xs text-muted">AI judge: {r.ai.reason}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
