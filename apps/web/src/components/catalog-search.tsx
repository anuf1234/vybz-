"use client";

import type { PlaybackSource, PlaybackTier } from "@vybz/providers";
import { useState, useTransition } from "react";
import { Player } from "./player";

interface Item {
  id: string;
  title: string;
  artistName: string;
  albumName?: string;
  releaseYear?: number;
  durationMs?: number;
  artworkUrl?: string;
  explicit?: boolean;
  sources: PlaybackSource[];
}

type MatchState = "idle" | "loading" | "none" | "error";

const TIER_LABEL: Record<PlaybackTier, string> = {
  HOSTED_FULL: "Full track",
  PROVIDER_FULL: "Full track",
  EMBED: "Video",
  PREVIEW: "30s preview",
  LINK_OUT: "Link only",
};

export function CatalogSearch({ canMatchYouTube }: { canMatchYouTube: boolean }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ itemId: string; source: PlaybackSource } | null>(null);
  const [matches, setMatches] = useState<Record<string, MatchState>>({});
  const [pending, startTransition] = useTransition();

  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    startTransition(async () => {
      setError(null);
      setActive(null);
      const res = await fetch(`/api/catalog/search?${new URLSearchParams({ q })}`);
      if (!res.ok) {
        setError(res.status === 503 ? "Music search is unavailable right now." : "Search failed. Try again.");
        setItems([]);
        return;
      }
      setItems((await res.json()).items);
    });
  }

  async function findVideo(item: Item) {
    const appleId = item.id.startsWith("APPLE_MUSIC:") ? item.id.slice("APPLE_MUSIC:".length) : null;
    if (!appleId) return;
    setMatches((m) => ({ ...m, [item.id]: "loading" }));
    const res = await fetch(`/api/catalog/youtube-match?${new URLSearchParams({ appleId })}`);
    if (!res.ok) return setMatches((m) => ({ ...m, [item.id]: "error" }));
    const body: { match: unknown; sources?: PlaybackSource[] } = await res.json();
    const embed = body.sources?.find((s) => s.tier === "EMBED");
    if (!embed) return setMatches((m) => ({ ...m, [item.id]: "none" }));
    setMatches((m) => ({ ...m, [item.id]: "idle" }));
    setItems((all) =>
      all.map((i) => (i.id === item.id ? { ...i, sources: [embed, ...i.sources.filter((s) => s.tier !== "EMBED")] } : i)),
    );
    setActive({ itemId: item.id, source: embed });
  }

  return (
    <div className="mt-6">
      <form onSubmit={search} className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Song or artist
        </label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={100}
          placeholder="Song or artist, e.g. Aaliyah Try Again"
          className="min-w-0 flex-1 rounded-full border border-line bg-surface-1 px-4 py-3 text-sm placeholder:text-muted/70 focus:border-violet focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-violet px-5 text-sm font-semibold text-white transition-colors hover:bg-violet/85 disabled:opacity-60"
        >
          {pending ? "Searching" : "Search"}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      <ul className="mt-6 space-y-2">
        {items.map((item) => {
          const best = item.sources[0];
          const isActive = active?.itemId === item.id;
          const match = matches[item.id] ?? "idle";
          const hasEmbed = item.sources.some((s) => s.tier === "EMBED");
          return (
            <li key={item.id} className="rounded-xl border border-line/70 bg-surface-1 p-3">
              <div className="flex items-center gap-3">
                {item.artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- provider-hosted art, shown as-is
                  <img src={item.artworkUrl} alt="" className="size-14 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="size-14 shrink-0 rounded-md bg-surface-3" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {item.title}
                    {item.explicit && (
                      <span className="ml-2 rounded bg-surface-3 px-1 text-[10px] text-muted" title="Explicit">
                        E
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {item.artistName}
                    {item.releaseYear ? ` · ${item.releaseYear}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {[...new Set(item.sources.map((s) => `${s.attribution.label}: ${TIER_LABEL[s.tier]}`))].map((label) => (
                      <span key={label} className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-violet-soft">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
                {best && best.tier !== "LINK_OUT" && (
                  <button
                    onClick={() => setActive(isActive ? null : { itemId: item.id, source: best })}
                    className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-violet"
                    aria-pressed={isActive}
                  >
                    {isActive ? "Close" : "Play"}
                  </button>
                )}
              </div>

              {canMatchYouTube && item.id.startsWith("APPLE_MUSIC:") && !hasEmbed && (
                <button
                  onClick={() => findVideo(item)}
                  disabled={match === "loading"}
                  className="mt-2 text-xs text-muted underline-offset-2 hover:text-text hover:underline disabled:opacity-60"
                >
                  {match === "loading"
                    ? "Looking on YouTube"
                    : match === "none"
                      ? "No matching YouTube video"
                      : match === "error"
                        ? "YouTube lookup failed, try again"
                        : "Find on YouTube"}
                </button>
              )}

              {isActive && active && <Player source={active.source} title={`${item.title} by ${item.artistName}`} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
