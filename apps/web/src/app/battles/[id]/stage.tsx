"use client";

import type { PlaybackSource } from "@vybz/providers";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Player } from "@/components/player";
import { Button, FormMessage } from "@/components/ui/form";
import {
  acceptBattle,
  cancelBattle,
  castVote,
  reportListen,
  requestRematch,
  submitPick,
} from "@/lib/actions/battles";
import type { PickView, RoundView } from "@/lib/battles/view";

/** Runs a server action, shows its refusal if any, and refreshes the server view on success. */
function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string } | void>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res && res.error) setError(res.error);
      else router.refresh();
    });
  return { pending, error, run };
}

export function ChallengeActions(props: {
  battleId: string;
  canAccept: boolean;
  canCancel: boolean;
  isCreator: boolean;
  signedIn: boolean;
}) {
  const { pending, error, run } = useAction();
  if (!props.signedIn) {
    return (
      <Link href="/sign-in" className="mt-4 block rounded-full bg-violet py-3 text-center text-sm font-semibold text-white">
        Sign in to accept
      </Link>
    );
  }
  if (!props.canAccept && !props.canCancel) return null;
  return (
    <div className="mt-4 space-y-2">
      {error && <FormMessage>{error}</FormMessage>}
      {props.canAccept && (
        <Button disabled={pending} onClick={() => run(() => acceptBattle(props.battleId))}>
          Accept challenge
        </Button>
      )}
      {props.canCancel && (
        <Button variant="ghost" disabled={pending} onClick={() => run(() => cancelBattle(props.battleId))}>
          {props.isCreator ? "Withdraw challenge" : "Decline"}
        </Button>
      )}
    </div>
  );
}

interface SearchItem {
  id: string;
  title: string;
  artistName: string;
  releaseYear?: number;
  artworkUrl?: string;
  sources: PlaybackSource[];
}

export function TrackPicker({ battleId, roundIndex }: { battleId: string; roundIndex: number }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const { pending, error, run } = useAction();

  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    startSearch(async () => {
      setSearchError(null);
      setPreview(null);
      const res = await fetch(`/api/catalog/search?${new URLSearchParams({ q })}`);
      if (!res.ok) {
        setSearchError("Search isn't working right now. Try again in a moment.");
        return;
      }
      // Battles pick from the Apple Music catalog; the server looks the track up again on submit.
      const body: { items: SearchItem[] } = await res.json();
      setItems(body.items.filter((i) => i.id.startsWith("APPLE_MUSIC:")));
    });
  }

  return (
    <div className="mt-4">
      <form onSubmit={search} role="search" className="flex gap-2">
        <label htmlFor="pick-q" className="sr-only">
          Song or artist
        </label>
        <input
          id="pick-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={100}
          placeholder="Search for your track"
          className="min-w-0 flex-1 rounded-full border border-line bg-surface-1 px-4 py-3 text-sm placeholder:text-muted/70 focus:border-violet focus:outline-none"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded-full bg-violet px-5 text-sm font-semibold text-white hover:bg-violet/85 disabled:opacity-60"
        >
          {searching ? "Searching" : "Search"}
        </button>
      </form>
      {(searchError || error) && (
        <div className="mt-3">
          <FormMessage>{searchError ?? error}</FormMessage>
        </div>
      )}
      {items && items.length === 0 && <p className="mt-4 text-sm text-muted">No matches. Try the artist and title.</p>}
      <ul className="mt-4 space-y-2">
        {items?.map((item) => {
          const appleId = item.id.slice("APPLE_MUSIC:".length);
          const source = item.sources.find((s) => s.tier !== "LINK_OUT");
          return (
            <li key={item.id} className="rounded-xl border border-line/70 bg-surface-1 p-3">
              <div className="flex items-center gap-3">
                {item.artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- provider-hosted art, shown as-is
                  <img src={item.artworkUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="size-12 shrink-0 rounded-md bg-surface-3" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="truncate text-sm text-muted">
                    {item.artistName}
                    {item.releaseYear ? ` · ${item.releaseYear}` : ""}
                  </p>
                </div>
                {source && (
                  <button
                    onClick={() => setPreview(preview === item.id ? null : item.id)}
                    aria-pressed={preview === item.id}
                    className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-violet"
                  >
                    {preview === item.id ? "Stop" : "Play"}
                  </button>
                )}
                <button
                  disabled={pending}
                  onClick={() => run(() => submitPick(battleId, roundIndex, appleId))}
                  className="rounded-full bg-violet px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet/85 disabled:opacity-60"
                >
                  Pick
                </button>
              </div>
              {preview === item.id && source && <Player source={source} title={`${item.title} by ${item.artistName}`} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type VotingView = Extract<RoundView, { kind: "voting" }>;

export function VotingRound({ battleId, round }: { battleId: string; round: VotingView }) {
  const [heard, setHeard] = useState<Record<string, number>>(() =>
    Object.fromEntries(round.cards.map((c) => [c.submissionId, c.playedMs])),
  );
  const { pending, error, run } = useAction();
  const tracking = round.voteBlock === null && round.votedFor === null;
  const ready = round.cards.every((c) => (heard[c.submissionId] ?? 0) >= c.requiredMs);

  const footer =
    round.votedFor !== null
      ? "Your vote is in. Results show when the round closes."
      : round.voteBlock === "BATTLER"
        ? "You're in this battle, so the crowd decides. Results show when the round closes."
        : round.voteBlock === "NOT_ELIGIBLE"
          ? "Confirm your email and pick a handle to vote."
          : round.voteBlock === "SIGN_IN"
            ? null
            : ready
              ? "Pick the one you'd keep on repeat."
              : "Listen to both tracks to unlock voting. Picks stay anonymous until the round closes.";

  return (
    <div className="mt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {round.cards.map((card, i) => (
          <VoteCard
            key={card.submissionId}
            label={i === 0 ? "A" : "B"}
            card={card}
            tracking={tracking}
            heardMs={heard[card.submissionId] ?? 0}
            onProgress={(ms) => setHeard((h) => ({ ...h, [card.submissionId]: Math.max(h[card.submissionId] ?? 0, ms) }))}
            chosen={round.votedFor === card.submissionId}
            canVote={tracking && ready}
            pending={pending}
            onVote={() => run(() => castVote(battleId, card.submissionId))}
          />
        ))}
      </div>
      {error && (
        <div className="mt-3">
          <FormMessage>{error}</FormMessage>
        </div>
      )}
      {footer && <p className="mt-3 text-center text-sm text-muted">{footer}</p>}
      {round.voteBlock === "SIGN_IN" && (
        <Link href="/sign-in" className="mt-3 block rounded-full bg-violet py-3 text-center text-sm font-semibold text-white">
          Sign in to vote
        </Link>
      )}
    </div>
  );
}

function VoteCard(props: {
  label: string;
  card: VotingView["cards"][number];
  tracking: boolean;
  heardMs: number;
  onProgress: (ms: number) => void;
  chosen: boolean;
  canVote: boolean;
  pending: boolean;
  onVote: () => void;
}) {
  const { card } = props;
  const share = Math.min(1, props.heardMs / card.requiredMs);
  const done = share >= 1;
  return (
    <article
      className={`rounded-2xl border bg-surface-1 p-4 ${props.chosen ? "border-win" : "border-line"}`}
      aria-label={`Track ${props.label}`}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-plum font-display font-bold text-violet-soft">
          {props.label}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">{card.title}</p>
          <p className="truncate text-sm text-muted">
            {card.artistName}
            {card.releaseYear ? ` · ${card.releaseYear}` : ""}
          </p>
        </div>
      </div>

      {card.source?.tier === "PREVIEW" ? (
        <ListenAudio
          src={card.source.url}
          maxMs={card.source.restrictions.maxPlayMs}
          title={`${card.title} by ${card.artistName}`}
          submissionId={card.submissionId}
          tracking={props.tracking}
          startMs={props.heardMs}
          onProgress={props.onProgress}
        />
      ) : (
        <p className="mt-3 text-sm text-muted">No preview is available for this pair.</p>
      )}
      {card.source && (
        <p className="mt-1 text-[11px] text-muted">
          {card.source.attribution.href ? (
            <a href={card.source.attribution.href} target="_blank" rel="noopener noreferrer" className="hover:text-text">
              Preview from {card.source.attribution.label} ↗
            </a>
          ) : (
            card.source.attribution.label
          )}
        </p>
      )}

      {props.tracking && (
        <div className="mt-3">
          <div
            className="h-1 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-label={`Listened to track ${props.label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share * 100)}
          >
            <div className={`h-full transition-[width] ${done ? "bg-live" : "bg-violet"}`} style={{ width: `${share * 100}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted">{done ? "Heard" : `Listen ${Math.ceil(card.requiredMs / 1000)}s to unlock`}</p>
        </div>
      )}

      {(props.tracking || props.chosen) && (
        <Button
          className="mt-4"
          variant={props.chosen ? "ghost" : "primary"}
          disabled={!props.canVote || props.pending}
          onClick={props.onVote}
        >
          {props.chosen ? "Your vote" : `Vote ${props.label}`}
        </Button>
      )}
    </article>
  );
}

/**
 * Preview audio that reports how much was actually played. Only forward play
 * counts (seeking ahead doesn't), and the server caps credit by wall-clock time.
 */
function ListenAudio(props: {
  src: string;
  maxMs: number | undefined;
  title: string;
  submissionId: string;
  tracking: boolean;
  startMs: number;
  onProgress: (ms: number) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const played = useRef(props.startMs);
  const reported = useRef(-1);
  const { submissionId, tracking, maxMs, onProgress } = props;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = el.currentTime;

    const send = async () => {
      if (!tracking || played.current === reported.current) return;
      reported.current = played.current;
      const res = await reportListen(submissionId, played.current);
      if (!("error" in res)) onProgress(res.playedMs);
    };
    const onPlay = () => {
      // Only one track at a time.
      document.querySelectorAll("audio").forEach((a) => a !== el && a.pause());
      last = el.currentTime;
      if (tracking && reported.current === -1) {
        reported.current = played.current;
        void reportListen(submissionId, played.current); // starts the server's clock
      }
    };
    const onTime = () => {
      const delta = el.currentTime - last;
      last = el.currentTime;
      if (delta > 0 && delta < 1.5) played.current += delta * 1000;
      if (maxMs && el.currentTime * 1000 >= maxMs) el.pause();
      if (played.current - reported.current >= 4_000) void send();
    };
    const onStop = () => void send();

    el.addEventListener("play", onPlay);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", onStop);
    el.addEventListener("ended", onStop);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", onStop);
      el.removeEventListener("ended", onStop);
    };
  }, [submissionId, tracking, maxMs, onProgress]);

  return <audio ref={ref} src={props.src} controls preload="none" className="mt-3 w-full" aria-label={`Play ${props.title}`} />;
}

export function PickPlayer({ pick }: { pick: PickView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{pick.title}</p>
          <p className="truncate text-sm text-muted">
            {pick.artistName}
            {pick.releaseYear ? ` · ${pick.releaseYear}` : ""}
          </p>
        </div>
        {pick.source ? (
          <button
            onClick={() => setOpen(!open)}
            aria-pressed={open}
            className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-violet"
          >
            {open ? "Close" : "Play"}
          </button>
        ) : (
          pick.externalUrl && (
            <a
              href={pick.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-violet"
            >
              Open ↗
            </a>
          )
        )}
      </div>
      {open && pick.source && <Player source={pick.source} title={`${pick.title} by ${pick.artistName}`} />}
    </div>
  );
}

export function RematchButton({ battleId, existingId }: { battleId: string; existingId: string | null }) {
  const { pending, error, run } = useAction();
  if (existingId) {
    return (
      <Link href={`/battles/${existingId}`} className="mt-4 inline-block text-sm font-semibold text-violet-soft hover:text-text">
        Go to the rematch →
      </Link>
    );
  }
  return (
    <div className="mx-auto mt-4 max-w-xs">
      {error && <FormMessage>{error}</FormMessage>}
      <Button disabled={pending} onClick={() => run(() => requestRematch(battleId))}>
        Rematch
      </Button>
    </div>
  );
}
