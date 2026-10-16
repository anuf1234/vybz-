"use client";

import type { PlaybackSource } from "@vybz/providers";
import { useState, useTransition } from "react";
import { Player } from "@/components/player";

export interface PickedTrack {
  appleId: string;
  title: string;
  artistName: string;
  releaseYear: number | null;
  artworkUrl: string | null;
}

interface SearchItem {
  id: string;
  title: string;
  artistName: string;
  releaseYear?: number;
  artworkUrl?: string;
  sources: PlaybackSource[];
}

function outOfEra(year: number | null, era: { from: number | null; to: number | null }) {
  if (year === null) return false;
  return (era.from !== null && year < era.from) || (era.to !== null && year > era.to);
}

/**
 * Builds a lineup: numbered slots plus a search box that drops each pick into
 * the next empty slot. Picks come from the Apple Music catalog; the server
 * looks every one up again (and re-checks the era) when the lineup is sent.
 */
export function SongPicker({
  size,
  value,
  onChange,
  era = { from: null, to: null },
  slotLabel = (i) => `Round ${i + 1}`,
}: {
  size: number;
  value: PickedTrack[];
  onChange: (next: PickedTrack[]) => void;
  era?: { from: number | null; to: number | null };
  slotLabel?: (i: number) => string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const full = value.length >= size;
  const picked = new Set(value.map((p) => p.appleId));

  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    startSearch(async () => {
      setError(null);
      setPreview(null);
      try {
        const res = await fetch(`/api/catalog/search?${new URLSearchParams({ q })}`);
        if (!res.ok) {
          setError(res.status === 503 ? "Music search isn't set up on this server." : "Search isn't working right now. Try again.");
          return;
        }
        const body: { items: SearchItem[] } = await res.json();
        setItems(body.items.filter((i) => i.id.startsWith("APPLE_MUSIC:")));
      } catch {
        setError("You look offline. Check your connection and try again.");
      }
    });
  }

  function add(item: SearchItem) {
    if (full) return;
    onChange([
      ...value,
      {
        appleId: item.id.slice("APPLE_MUSIC:".length),
        title: item.title,
        artistName: item.artistName,
        releaseYear: item.releaseYear ?? null,
        artworkUrl: item.artworkUrl ?? null,
      },
    ]);
  }

  function move(i: number, by: -1 | 1) {
    const j = i + by;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  }

  return (
    <div>
      <ol className="space-y-1.5" aria-label="Your picks">
        {Array.from({ length: size }, (_, i) => {
          const p = value[i];
          return (
            <li
              key={i}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${p ? "border-line bg-surface-1" : "border-dashed border-line/70"}`}
            >
              <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted">{slotLabel(i)}</span>
              {p ? (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="truncate text-xs text-muted">
                      {p.artistName}
                      {p.releaseYear ? ` · ${p.releaseYear}` : ""}
                      {outOfEra(p.releaseYear, era) && <span className="ml-1 text-amber-200">· outside the era</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${p.title} up`} className="px-1.5 text-muted hover:text-text disabled:opacity-30">
                      ↑
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} aria-label={`Move ${p.title} down`} className="px-1.5 text-muted hover:text-text disabled:opacity-30">
                      ↓
                    </button>
                    <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} aria-label={`Remove ${p.title}`} className="px-1.5 text-muted hover:text-red-300">
                      ✕
                    </button>
                  </div>
                </>
              ) : (
                <span className="text-sm text-muted/70">{i === value.length ? "Next pick goes here" : "Empty"}</span>
              )}
            </li>
          );
        })}
      </ol>

      {!full && (
        <form onSubmit={search} role="search" className="mt-4 flex gap-2">
          <label htmlFor="song-q" className="sr-only">
            Song or artist
          </label>
          <input
            id="song-q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
            placeholder="Search a song or artist"
            className="min-w-0 flex-1 rounded-full border border-line bg-surface-1 px-4 py-3 text-sm placeholder:text-muted/70 focus:border-violet focus:outline-none"
          />
          <button type="submit" disabled={searching} className="rounded-full bg-violet px-5 text-sm font-semibold text-white hover:bg-violet/85 disabled:opacity-60">
            {searching ? "…" : "Search"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
      {!full && items && items.length === 0 && <p className="mt-3 text-sm text-muted">No matches. Try the artist and the title.</p>}
      {!full && items && items.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {items.map((item) => {
            const source = item.sources.find((s) => s.tier !== "LINK_OUT");
            const id = item.id.slice("APPLE_MUSIC:".length);
            const taken = picked.has(id);
            const wrongEra = outOfEra(item.releaseYear ?? null, era);
            return (
              <li key={item.id} className="rounded-xl border border-line/70 bg-surface-1 p-2.5">
                <div className="flex items-center gap-3">
                  {item.artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- provider-hosted art, shown as-is
                    <img src={item.artworkUrl} alt="" className="size-11 shrink-0 rounded-md object-cover" />
                  ) : (
                    <div className="size-11 shrink-0 rounded-md bg-surface-3" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted">
                      {item.artistName}
                      {item.releaseYear ? ` · ${item.releaseYear}` : ""}
                    </p>
                  </div>
                  {source && (
                    <button
                      type="button"
                      onClick={() => setPreview(preview === item.id ? null : item.id)}
                      aria-pressed={preview === item.id}
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-violet"
                    >
                      {preview === item.id ? "Stop" : "Play"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={taken || wrongEra}
                    onClick={() => add(item)}
                    title={wrongEra ? "Outside this battle's era" : undefined}
                    className="rounded-full bg-violet px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet/85 disabled:opacity-40"
                  >
                    {taken ? "Added" : wrongEra ? "Era" : "Add"}
                  </button>
                </div>
                {preview === item.id && source && <Player source={source} title={`${item.title} by ${item.artistName}`} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
