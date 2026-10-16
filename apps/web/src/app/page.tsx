import Link from "next/link";

const rounds = [
  { a: 412, b: 388 },
  { a: 290, b: 501 },
  { a: 466, b: 430 },
];

export default function Home() {
  const won = rounds.reduce((acc, r) => acc + (r.a > r.b ? 1 : 0), 0);
  return (
    <div className="pt-10 sm:pt-16">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-soft">Competitive music</p>
      <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[0.95] sm:text-7xl">
        Your taste.
        <br />
        <span className="text-violet">Their vote.</span>
      </h1>
      <p className="mt-5 max-w-md text-muted">
        Challenge anyone to a song battle. Ten rounds, one track each, and the crowd listens and decides who has the
        better ear.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/battles"
          className="rounded-full bg-violet px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet/85"
        >
          Start a battle
        </Link>
        <Link href="/search" className="rounded-full border border-line px-6 py-3 text-sm font-semibold hover:border-violet">
          Find a track
        </Link>
      </div>

      <section aria-label="Example battle" className="mt-14 rounded-2xl border border-line bg-surface-1 p-5">
        <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted">
          <span>2000s R&amp;B · Round 3 of 10</span>
          <span className="flex items-center gap-2 text-live">
            <span className="size-2 rounded-full bg-live" aria-hidden /> Live
          </span>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div>
            <p className="text-sm text-muted">@slowjamsonly</p>
            <p className="font-display text-5xl font-bold tabular-nums">{won}</p>
          </div>
          <span className="font-display text-lg text-muted">VS</span>
          <div className="text-right">
            <p className="text-sm text-muted">@neosoulnate</p>
            <p className="font-display text-5xl font-bold tabular-nums">{rounds.length - won}</p>
          </div>
        </div>
        <ol className="mt-5 space-y-2">
          {rounds.map((r, i) => {
            const share = Math.round((r.a / (r.a + r.b)) * 100);
            return (
              <li key={i} className="flex items-center gap-3 text-xs text-muted">
                <span className="w-6 tabular-nums">R{i + 1}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full bg-violet" style={{ width: `${share}%` }} />
                </div>
                <span className="w-10 text-right tabular-nums">{share}%</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
