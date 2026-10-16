"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { MixUpload } from "@/components/battle/mix-upload";
import { type PickedTrack, SongPicker } from "@/components/battle/song-picker";
import { Btn, LinkButton } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { ShareButton } from "@/components/ui/share-button";
import { acceptBattle, cancelBattle, castVote, reportListen, submitLineup } from "@/lib/actions/battles";
import { postComment, removeComment, toggleReaction } from "@/lib/actions/social";
import type { ActionResult } from "@/lib/actions/run";
import type { BattleView, EntryView, RoundView, TrackView } from "@/lib/battles/view";

/** Runs a server action, shows its refusal, and refreshes the server view on success. */
function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = <T,>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T) => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) {
        if (res.code === "UNAUTHORIZED") router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        else setError(res.error);
        return;
      }
      onOk?.(res.data);
      router.refresh();
    });
  return { pending, error, run };
}

// ─── Challenge ────────────────────────────────────────────────────────────

export function ChallengeActions({ b }: { b: BattleView }) {
  const { pending, error, run } = useAction();
  const v = b.viewer;
  const isCreator = v.side === 0;
  if (!v.signedIn) {
    return (
      <LinkButton href={`/login?next=/battle/${b.id}`} block size="lg" className="mt-5">
        Log in to accept
      </LinkButton>
    );
  }
  if (!v.canAccept && !v.canCancel) return null;
  return (
    <div className="mt-5 space-y-2">
      {error && <FormMessage>{error}</FormMessage>}
      {v.canAccept && (
        <Btn block size="lg" disabled={pending} onClick={() => run(() => acceptBattle(b.id))}>
          Accept challenge
        </Btn>
      )}
      {v.canCancel && (
        <Btn block variant="ghost" disabled={pending} onClick={() => run(() => cancelBattle(b.id))}>
          {isCreator ? "Withdraw challenge" : b.status === "ACCEPTED" ? "Back out" : "Decline"}
        </Btn>
      )}
    </div>
  );
}

// ─── Lineup (opponent, after accepting) ────────────────────────────────────

export function LineupBuilder({ b, canSearch, canUpload }: { b: BattleView; canSearch: boolean; canUpload: boolean }) {
  const [picks, setPicks] = useState<PickedTrack[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const { pending, error, run } = useAction();
  const size = b.type === "SONG_FOR_SONG" ? b.roundCount : b.type === "PLAYLIST" ? (b.playlistLength ?? 0) : 1;
  const ready = b.type === "DJ_MIX" ? uploadId !== null : picks.length === size;

  return (
    <div className="mt-5 space-y-4">
      {b.type === "DJ_MIX" ? (
        canUpload ? (
          <MixUpload onReady={setUploadId} />
        ) : (
          <FormMessage>Mix uploads aren&apos;t set up on this server yet.</FormMessage>
        )
      ) : canSearch ? (
        <SongPicker
          size={size}
          value={picks}
          onChange={setPicks}
          era={{ from: b.eraFrom, to: b.eraTo }}
          {...(b.type === "PLAYLIST" ? { slotLabel: (i: number) => `Track ${i + 1}` } : {})}
        />
      ) : (
        <FormMessage>Music search isn&apos;t set up on this server yet.</FormMessage>
      )}
      {error && <FormMessage>{error}</FormMessage>}
      <Btn
        block
        size="lg"
        disabled={!ready || pending}
        onClick={() => run(() => submitLineup(b.id, b.type === "DJ_MIX" ? { uploadId } : { appleIds: picks.map((p) => p.appleId) }))}
      >
        {pending ? "Locking in…" : ready ? "Lock in my picks" : `Pick ${size - picks.length} more`}
      </Btn>
    </div>
  );
}

// ─── Rounds ────────────────────────────────────────────────────────────────

export function RoundStepper({ b, startAt }: { b: BattleView; startAt: number }) {
  const [i, setI] = useState(startAt);
  const round = b.rounds[i]!;
  const n = b.rounds.length;
  return (
    <section aria-label="Rounds" className="mt-6">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setI(i - 1)} disabled={i === 0} aria-label="Previous round" className="grid size-10 place-items-center rounded-full border border-line disabled:opacity-30">
          ←
        </button>
        <p className="font-display text-xl font-bold uppercase tracking-wider" aria-live="polite">
          {n > 1 ? `Round ${i + 1} of ${n}` : b.typeLabel}
        </p>
        <button type="button" onClick={() => setI(i + 1)} disabled={i === n - 1} aria-label="Next round" className="grid size-10 place-items-center rounded-full border border-line disabled:opacity-30">
          →
        </button>
      </div>
      {n > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {b.rounds.map((r) => (
            <button
              key={r.index}
              type="button"
              onClick={() => setI(r.index)}
              aria-label={`Round ${r.index + 1}${r.myVote !== null ? ", voted" : ""}`}
              aria-current={r.index === i ? "true" : undefined}
              className={`h-1.5 rounded-full transition-all ${r.index === i ? "w-6 bg-violet" : r.myVote !== null ? "w-3 bg-violet/50" : r.revealed ? "w-3 bg-surface-3" : "w-3 bg-surface-2"}`}
            />
          ))}
        </div>
      )}
      <Round key={round.index} b={b} round={round} onNext={i < n - 1 ? () => setI(i + 1) : null} />
    </section>
  );
}

function Round({ b, round, onNext }: { b: BattleView; round: RoundView; onNext: (() => void) | null }) {
  const [heard, setHeard] = useState<[number, number]>(round.listened);
  // Right after voting, show the counts the vote returned until the refreshed view arrives.
  const [cast, setCast] = useState<{ side: 0 | 1; votes: [number, number] } | null>(null);
  const votes = round.votes ?? cast?.votes ?? null;
  const myVote = round.myVote ?? cast?.side ?? null;
  const { pending, error, run } = useAction();
  const v = b.viewer;
  const live = b.status === "ACTIVE" || b.status === "VOTING";
  const canVote = live && round.revealed && v.voteBlock === null && myVote === null;
  const ready = heard[0] >= round.requiredMs && heard[1] >= round.requiredMs;
  const names = [b.players[0].username, b.players[1]?.username ?? "?"] as const;

  if (!round.revealed) {
    return (
      <div className="mt-5 rounded-2xl border border-dashed border-line p-8 text-center">
        <p className="text-3xl" aria-hidden>
          🔒
        </p>
        <p className="mt-2 font-semibold">This round drops soon</p>
        {round.revealAt && <p className="mt-1 text-sm text-muted">{round.revealAt.toLocaleString()}</p>}
      </div>
    );
  }

  const footer =
    myVote !== null
      ? `You voted for @${names[myVote]}.`
      : v.voteBlock === "PLAYER"
        ? "You're in this battle, so the crowd decides."
        : v.voteBlock === "NOT_ELIGIBLE"
          ? "Confirm your email and pick a username to vote."
          : v.voteBlock === "CLOSED" || !live
            ? "Voting is closed."
            : v.voteBlock === "SIGN_IN"
              ? null
              : ready
                ? "Pick the one you'd keep on repeat."
                : `Listen to at least ${Math.round(round.requiredMs / 1000)}s of both sides to unlock voting.`;

  return (
    <div className="mt-5">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {([0, 1] as const).map((side) => (
          <EntryCard
            key={side}
            label={side === 0 ? "A" : "B"}
            player={names[side]}
            entry={round.entries[side]}
            tracking={canVote}
            heardMs={heard[side]}
            requiredMs={round.requiredMs}
            onProgress={(ms) => setHeard((h) => (side === 0 ? [Math.max(h[0], ms), h[1]] : [h[0], Math.max(h[1], ms)]))}
            votes={votes?.[side] ?? null}
            total={votes ? votes[0] + votes[1] : 0}
            chosen={myVote === side}
            winner={round.winnerSide === side}
          />
        ))}
      </div>

      {canVote && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
          {([0, 1] as const).map((side) => (
            <Btn
              key={side}
              size="lg"
              disabled={!ready || pending}
              onClick={() =>
                run(
                  () => castVote(b.id, round.index, side),
                  (d) => setCast({ side, votes: d.votes }),
                )
              }
            >
              Vote {side === 0 ? "A" : "B"}
            </Btn>
          ))}
        </div>
      )}
      {v.voteBlock === "SIGN_IN" && live && (
        <LinkButton href={`/login?next=/battle/${b.id}`} block size="lg" className="mt-3">
          Log in to vote
        </LinkButton>
      )}
      {error && (
        <div className="mt-3">
          <FormMessage>{error}</FormMessage>
        </div>
      )}
      {footer && <p className="mt-3 text-center text-sm text-muted">{footer}</p>}
      {votes === null && b.hideTotals && live && myVote === null && v.side === null && (
        <p className="mt-1 text-center text-xs text-muted">Vote counts show after you vote.</p>
      )}
      {myVote !== null && onNext && (
        <Btn block variant="subtle" className="mt-3" onClick={onNext}>
          Next round →
        </Btn>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Reactions battleId={b.id} round={round} enabled={v.signedIn && b.status !== "CANCELLED"} />
        <ShareButton path={`/battle/${b.id}`} title={b.title} text={`Who wins round ${round.index + 1}? Vote on VYBZ.`} />
      </div>
    </div>
  );
}

function EntryCard(props: {
  label: string;
  player: string;
  entry: EntryView | null;
  tracking: boolean;
  heardMs: number;
  requiredMs: number;
  onProgress: (ms: number) => void;
  votes: number | null;
  total: number;
  chosen: boolean;
  winner: boolean;
}) {
  const { entry } = props;
  const share = Math.min(1, props.heardMs / props.requiredMs);
  const pct = props.votes !== null && props.total > 0 ? Math.round((props.votes / props.total) * 100) : null;
  return (
    <article
      aria-label={`Side ${props.label}, @${props.player}`}
      className={`flex min-w-0 flex-col rounded-2xl border bg-surface-1 p-3 ${props.chosen ? "border-violet" : props.winner ? "border-win" : "border-line"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-plum font-display text-sm font-bold text-violet-soft">{props.label}</span>
        <span className="truncate text-xs text-muted">@{props.player}</span>
      </div>
      {!entry ? (
        <p className="mt-3 text-sm text-muted">Hidden</p>
      ) : entry.kind === "track" ? (
        <>
          <Artwork url={entry.artworkUrl} />
          <p className="mt-2 line-clamp-2 text-sm font-semibold leading-tight">{entry.title}</p>
          <p className="truncate text-xs text-muted">
            {entry.artistName}
            {entry.releaseYear ? ` · ${entry.releaseYear}` : ""}
          </p>
          <TrackPlayback t={entry} submissionId={entry.submissionId} tracking={props.tracking} heardMs={props.heardMs} onProgress={props.onProgress} />
        </>
      ) : entry.kind === "playlist" ? (
        <>
          <p className="mt-2 text-sm font-semibold">{entry.title}</p>
          <ol className="mt-2 space-y-2">
            {entry.tracks.map((t, k) => (
              <li key={k} className="text-xs">
                <p className="truncate font-medium">
                  {k + 1}. {t.title}
                </p>
                <p className="truncate text-muted">{t.artistName}</p>
                <TrackPlayback t={t} submissionId={entry.submissionId} tracking={props.tracking} heardMs={props.heardMs} onProgress={props.onProgress} compact />
              </li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <div className="mt-2 grid aspect-square place-items-center rounded-xl bg-plum text-4xl" aria-hidden>
            🎛️
          </div>
          <p className="mt-2 truncate text-sm font-semibold">{entry.title}</p>
          {entry.url ? (
            <ListenAudio src={entry.url} title={entry.title} submissionId={entry.submissionId} tracking={props.tracking} startMs={props.heardMs} onProgress={props.onProgress} maxMs={undefined} />
          ) : (
            <p className="mt-2 text-xs text-muted">Mix unavailable.</p>
          )}
        </>
      )}

      {props.tracking && (
        <div className="mt-auto pt-3">
          <div className="h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={`Listened to side ${props.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
            <div className={`h-full transition-[width] ${share >= 1 ? "bg-live" : "bg-violet"}`} style={{ width: `${share * 100}%` }} />
          </div>
          <p className="mt-1 text-[10px] text-muted">{share >= 1 ? "Heard" : "Listening unlocks voting"}</p>
        </div>
      )}
      {props.votes !== null && (
        <div className="mt-auto pt-3">
          <p className="font-display text-2xl font-bold tabular-nums">
            {props.votes}
            {pct !== null && <span className="ml-1 text-sm font-normal text-muted">{pct}%</span>}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-muted">{props.winner ? "Won the round" : props.votes === 1 ? "vote" : "votes"}</p>
        </div>
      )}
    </article>
  );
}

function Artwork({ url }: { url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- provider-hosted art, shown as-is
    <img src={url} alt="" className="mt-2 aspect-square w-full rounded-xl object-cover" />
  ) : (
    <div className="mt-2 grid aspect-square w-full place-items-center rounded-xl bg-surface-3 text-3xl" aria-hidden>
      ♪
    </div>
  );
}

function TrackPlayback({
  t,
  submissionId,
  tracking,
  heardMs,
  onProgress,
  compact = false,
}: {
  t: TrackView;
  submissionId: string;
  tracking: boolean;
  heardMs: number;
  onProgress: (ms: number) => void;
  compact?: boolean;
}) {
  const s = t.source;
  return (
    <div className={compact ? "mt-1" : "mt-2"}>
      {s?.tier === "PREVIEW" ? (
        <ListenAudio src={s.url} maxMs={s.restrictions.maxPlayMs} title={`${t.title} by ${t.artistName}`} submissionId={submissionId} tracking={tracking} startMs={heardMs} onProgress={onProgress} />
      ) : s?.tier === "EMBED" ? (
        <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(s.embed.videoId)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-soft">
          Watch on YouTube ↗
        </a>
      ) : (
        <p className="text-[11px] text-muted">No preview for this pair.</p>
      )}
      {!compact && (s?.attribution.href || t.externalUrl) && (
        <a href={s?.attribution.href ?? t.externalUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[10px] text-muted hover:text-text">
          {s?.tier === "PREVIEW" ? `Preview from ${s.attribution.label}` : "Open in Apple Music"} ↗
        </a>
      )}
    </div>
  );
}

/**
 * Audio that reports how much was actually played. Only forward play counts
 * (seeking ahead doesn't), and the server caps credit by wall-clock time.
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
  const onProgress = useRef(props.onProgress);
  useEffect(() => {
    onProgress.current = props.onProgress;
  });
  const { submissionId, tracking, maxMs } = props;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = el.currentTime;

    const send = async () => {
      if (!tracking || played.current === reported.current) return;
      reported.current = played.current;
      const res = await reportListen(submissionId, played.current);
      if (res.ok) onProgress.current(res.data.playedMs);
    };
    const onPlay = () => {
      // One thing at a time.
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
      if (played.current - reported.current >= 3_000) void send();
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
  }, [submissionId, tracking, maxMs]);

  return <audio ref={ref} src={props.src} controls preload="none" className="mt-1 h-9 w-full" aria-label={`Play ${props.title}`} data-submission={submissionId} />;
}

function Reactions({ battleId, round, enabled }: { battleId: string; round: RoundView; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, flip] = useOptimistic(round.reactions, (all, kind: string) =>
    all.map((x) => (x.kind === kind ? { ...x, mine: !x.mine, count: x.count + (x.mine ? -1 : 1) } : x)),
  );
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Reactions">
      {shown.map((r) => (
        <button
          key={r.kind}
          type="button"
          disabled={!enabled || pending}
          aria-pressed={r.mine}
          aria-label={`${r.label}, ${r.count}`}
          onClick={() =>
            start(async () => {
              flip(r.kind);
              const res = await toggleReaction(battleId, round.index, r.kind);
              if (res.ok) router.refresh();
            })
          }
          className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm ${r.mine ? "border-violet bg-plum" : "border-line"} disabled:opacity-60`}
        >
          <span aria-hidden>{r.emoji}</span>
          {r.count > 0 && <span className="text-xs tabular-nums text-muted">{r.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Comments ──────────────────────────────────────────────────────────────

export interface CommentView {
  id: string;
  body: string;
  author: string;
  mine: boolean;
  canRemove: boolean;
  round: number | null;
  at: string;
}

export function Comments({ battleId, comments, canComment, signedIn }: { battleId: string; comments: CommentView[]; canComment: boolean; signedIn: boolean }) {
  const [body, setBody] = useState("");
  const { pending, error, run } = useAction();
  return (
    <section aria-label="Comments" className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-soft">Comments</h2>
      {canComment ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            run(() => postComment(battleId, body, null), () => setBody(""));
          }}
        >
          <label htmlFor="comment" className="sr-only">
            Add a comment
          </label>
          <input
            id="comment"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            placeholder="Say something"
            className="min-w-0 flex-1 rounded-full border border-line bg-surface-1 px-4 py-2.5 text-sm placeholder:text-muted/70 focus:border-violet focus:outline-none"
          />
          <Btn type="submit" size="sm" disabled={pending || !body.trim()}>
            Post
          </Btn>
        </form>
      ) : (
        <p className="mt-3 text-sm text-muted">
          {signedIn ? (
            "Confirm your email and pick a username to comment."
          ) : (
            <>
              <Link href={`/login?next=/battle/${battleId}`} className="underline underline-offset-2">
                Log in
              </Link>{" "}
              to comment.
            </>
          )}
        </p>
      )}
      {error && (
        <div className="mt-2">
          <FormMessage>{error}</FormMessage>
        </div>
      )}
      {comments.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <p>
                <Link href={`/profile/${c.author}`} className="font-semibold hover:underline">
                  @{c.author}
                </Link>
                {c.round !== null && <span className="ml-2 text-xs text-muted">Round {c.round + 1}</span>}
                <span className="ml-2 text-xs text-muted">{c.at}</span>
              </p>
              <p className="mt-0.5 whitespace-pre-line break-words">{c.body}</p>
              {c.canRemove && (
                <button type="button" onClick={() => run(() => removeComment(battleId, c.id))} className="mt-0.5 text-xs text-muted hover:text-red-300">
                  {c.mine ? "Delete" : "Hide"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
