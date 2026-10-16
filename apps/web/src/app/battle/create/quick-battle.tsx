"use client";

import {
  BATTLE_TYPE_LABELS,
  DEFAULT_VOTING_MS,
  GENRES,
  PLAYLIST_LENGTH_OPTIONS,
  QUICK_ROUND_OPTIONS,
  REVEAL_INTERVALS,
  ROUND_OPTIONS,
  THEME_PRESETS,
  VOTING_DURATIONS,
} from "@vybz/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MixUpload } from "@/components/battle/mix-upload";
import { type PickedTrack, SongPicker } from "@/components/battle/song-picker";
import { Btn, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FormMessage, TextArea } from "@/components/ui/form";
import { ChoiceGroup, Select } from "@/components/ui/select";
import { createBattle, findOpponent } from "@/lib/actions/battles";

type Mode = "DIRECT" | "MATCHMAKING" | "OPEN";
type Type = "SONG_FOR_SONG" | "PLAYLIST" | "DJ_MIX";
type Genre = (typeof GENRES)[number];

export interface Prefill {
  opponent?: string;
  presetId?: string;
  rematchOf?: string;
  setup?: {
    type: Type;
    theme: string;
    genre: string | null;
    roundCount: number;
    playlistLength: number | null;
    eraFrom: number | null;
    eraTo: number | null;
    votingDurationMs: number;
    hideTotals: boolean;
    visibility: "PUBLIC" | "PRIVATE";
    title: string;
  };
}

const MODES: { value: Mode; label: string; hint: string; icon: string }[] = [
  { value: "DIRECT", label: "Challenge a friend", hint: "Send it to one @username", icon: "🎯" },
  { value: "MATCHMAKING", label: "Find an opponent", hint: "We match you with someone waiting", icon: "🎲" },
  { value: "OPEN", label: "Open challenge", hint: "Post it. Anyone can accept", icon: "📣" },
];

const STEPS = ["Who", "Theme", "Format", "Your picks", "Send"] as const;

/**
 * Quick Battle: five short steps, sensible defaults, everything else tucked
 * under "More options". The server re-validates every field.
 */
export function QuickBattle({
  me,
  prefill,
  welcome,
  canSearch,
  canUpload,
}: {
  me: string;
  prefill: Prefill;
  welcome: boolean;
  canSearch: boolean;
  canUpload: boolean;
}) {
  const router = useRouter();
  const rematch = Boolean(prefill.rematchOf);
  const pre = prefill.setup;
  const preset = THEME_PRESETS.find((t) => t.id === prefill.presetId);

  const [step, setStep] = useState(rematch ? 3 : prefill.opponent ? 1 : 0);
  const [mode, setMode] = useState<Mode>("DIRECT");
  const [opponent, setOpponent] = useState(prefill.opponent ?? "");
  const [themeId, setThemeId] = useState<string | null>(preset?.id ?? (pre ? "custom" : null));
  const [customTheme, setCustomTheme] = useState(pre?.theme ?? "");
  const [type, setType] = useState<Type>(pre?.type ?? "SONG_FOR_SONG");
  const [rounds, setRounds] = useState<number>(pre?.roundCount ?? 5);
  const [moreRounds, setMoreRounds] = useState(pre ? !(QUICK_ROUND_OPTIONS as readonly number[]).includes(pre.roundCount) : false);
  const [playlistLength, setPlaylistLength] = useState<number>(pre?.playlistLength ?? 5);
  const [picks, setPicks] = useState<PickedTrack[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [tagline, setTagline] = useState("");
  const [title, setTitle] = useState(pre?.title ?? "");
  const [genre, setGenre] = useState<string>(pre?.genre ?? preset?.genre ?? "");
  const [eraFrom, setEraFrom] = useState<string>(pre?.eraFrom?.toString() ?? preset?.eraFrom?.toString() ?? "");
  const [eraTo, setEraTo] = useState<string>(pre?.eraTo?.toString() ?? preset?.eraTo?.toString() ?? "");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">(pre?.visibility ?? "PUBLIC");
  const [votingMs, setVotingMs] = useState<number>(pre?.votingDurationMs ?? DEFAULT_VOTING_MS);
  const [revealMs, setRevealMs] = useState<number>(0);
  const [hideTotals, setHideTotals] = useState(pre?.hideTotals ?? true);
  const [premiere, setPremiere] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [match, setMatch] = useState<{ id: string } | "none" | null>(null);
  const [pending, start] = useTransition();

  const chosenPreset = THEME_PRESETS.find((t) => t.id === themeId);
  const theme = themeId === "custom" ? customTheme.trim() : (chosenPreset?.label ?? "");
  const era = { from: eraFrom ? Number(eraFrom) : null, to: eraTo ? Number(eraTo) : null };
  const roundCount = type === "SONG_FOR_SONG" ? rounds : 1;
  const lineupSize = type === "SONG_FOR_SONG" ? rounds : type === "PLAYLIST" ? playlistLength : 1;
  const picksDone = type === "DJ_MIX" ? uploadId !== null : picks.length === lineupSize;

  function pickPreset(id: string) {
    setThemeId(id);
    const p = THEME_PRESETS.find((t) => t.id === id);
    if (p) {
      setGenre(p.genre ?? "");
      setEraFrom(p.eraFrom?.toString() ?? "");
      setEraTo(p.eraTo?.toString() ?? "");
    }
  }

  function canNext(): boolean {
    if (step === 0) return mode !== "DIRECT" || /^[a-z0-9_]{3,20}$/i.test(opponent.replace(/^@/, ""));
    if (step === 1) return theme.length >= 2;
    if (step === 3) return picksDone;
    return true;
  }

  function next() {
    setError(null);
    if (step === 2 && mode === "MATCHMAKING" && match === null) {
      // Look for someone already waiting with the same battle before picking songs.
      start(async () => {
        const res = await findOpponent({ theme, type, roundCount });
        if (!res.ok) return setError(res.error);
        if (res.data) setMatch(res.data);
        else {
          setMatch("none");
          setStep(3);
        }
      });
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setError(null);
    if (step === 3) setMatch(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  function submit() {
    setError(null);
    setFields({});
    const setup = {
      type,
      mode,
      title: title.trim() || `${theme} battle`,
      theme,
      genre: (genre || null) as Genre | null,
      tagline: tagline.trim() || null,
      roundCount,
      playlistLength: type === "PLAYLIST" ? playlistLength : null,
      visibility,
      votingDurationMs: votingMs,
      revealIntervalMs: type === "SONG_FOR_SONG" ? revealMs : 0,
      hideTotals,
      eraFrom: era.from,
      eraTo: era.to,
      scheduledFor: premiere ? new Date(premiere).toISOString() : null,
    };
    const lineup = type === "DJ_MIX" ? { uploadId } : { appleIds: picks.map((p) => p.appleId) };
    start(async () => {
      const res = await createBattle({
        setup,
        opponent: mode === "DIRECT" ? opponent.replace(/^@/, "") : null,
        lineup,
        rematchOf: prefill.rematchOf ?? null,
      });
      if (res.ok) {
        router.push(`/battle/${res.data.id}?sent=1`);
        return;
      }
      if (res.code === "UNAUTHORIZED") return router.push("/login?next=/battle/create");
      setError(res.error);
      setFields(res.fieldErrors ?? {});
    });
  }

  return (
    <div className="mx-auto max-w-xl pt-6">
      {welcome && step === 0 && (
        <p className="mb-4 rounded-xl border border-violet/40 bg-violet/10 px-4 py-3 text-sm text-violet-soft">
          You&apos;re in. Start your first battle; it takes about a minute.
        </p>
      )}
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-soft">{rematch ? "Rematch" : "Quick battle"}</p>
      <h1 className="mt-1 font-display text-4xl font-bold uppercase leading-none">{STEPS[step]}</h1>

      <ol className="mt-4 flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <li key={s} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-violet" : "bg-surface-3"}`} aria-current={i === step ? "step" : undefined}>
            <span className="sr-only">{s}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 space-y-5">
        {step === 0 && (
          <>
            <div className="grid gap-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  aria-pressed={mode === m.value}
                  className={`flex items-center gap-4 rounded-2xl border px-4 py-4 text-left transition-colors ${mode === m.value ? "border-violet bg-plum" : "border-line bg-surface-1 hover:border-violet/60"}`}
                >
                  <span className="text-2xl" aria-hidden>
                    {m.icon}
                  </span>
                  <span>
                    <span className="block font-semibold">{m.label}</span>
                    <span className="block text-sm text-muted">{m.hint}</span>
                  </span>
                </button>
              ))}
            </div>
            {mode === "DIRECT" && (
              <Field
                label="Who are you challenging?"
                name="opponent"
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                placeholder="@username"
                autoComplete="off"
                autoCapitalize="none"
                error={fields.opponent}
              />
            )}
          </>
        )}

        {step === 1 && (
          <>
            <div className="flex flex-wrap gap-2">
              {THEME_PRESETS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickPreset(t.id)}
                  aria-pressed={themeId === t.id}
                  className={`rounded-full border px-4 py-2 text-sm font-medium ${themeId === t.id ? "border-violet bg-violet text-white" : "border-line bg-surface-1 hover:border-violet/60"}`}
                >
                  {t.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setThemeId("custom")}
                aria-pressed={themeId === "custom"}
                className={`rounded-full border border-dashed px-4 py-2 text-sm font-medium ${themeId === "custom" ? "border-violet text-text" : "border-line text-muted"}`}
              >
                + Custom
              </button>
            </div>
            {themeId === "custom" && (
              <Field label="Your theme" name="theme" value={customTheme} onChange={(e) => setCustomTheme(e.target.value)} maxLength={60} placeholder="e.g. Songs for a 2am drive" error={fields.theme} />
            )}
          </>
        )}

        {step === 2 && (
          <>
            {type === "SONG_FOR_SONG" && (
              <>
                <ChoiceGroup
                  legend="How many rounds?"
                  name="rounds"
                  value={rounds}
                  onChange={setRounds}
                  options={(moreRounds ? ROUND_OPTIONS : QUICK_ROUND_OPTIONS).map((n) => ({ value: n, label: `${n} rounds`, hint: `${n} songs each` }))}
                />
                {!moreRounds && (
                  <button type="button" onClick={() => setMoreRounds(true)} className="text-xs text-muted underline-offset-2 hover:underline">
                    Other round counts
                  </button>
                )}
              </>
            )}
            {type === "PLAYLIST" && (
              <ChoiceGroup
                legend="Tracks per playlist"
                name="playlistLength"
                columns={4}
                value={playlistLength}
                onChange={setPlaylistLength}
                options={PLAYLIST_LENGTH_OPTIONS.map((n) => ({ value: n, label: `${n}` }))}
              />
            )}
            {type === "DJ_MIX" && <p className="text-sm text-muted">One round: your uploaded mix against theirs.</p>}
            <ChoiceGroup<Type>
              legend="Battle format"
              name="type"
              value={type}
              onChange={(t) => {
                setType(t);
                setPicks([]);
                setUploadId(null);
                setMatch(null);
              }}
              options={[
                { value: "SONG_FOR_SONG", label: "Song for song", hint: "One song per round" },
                { value: "PLAYLIST", label: "Playlist", hint: "Whole playlist vs playlist" },
                { value: "DJ_MIX", label: "DJ mix", hint: canUpload ? "Upload your own mix" : "Uploads unavailable" },
              ]}
            />
            <p className="text-xs text-muted">Live DJ battles are coming later.</p>
            {match && match !== "none" && (
              <Card className="border-violet">
                <p className="font-semibold">Someone&apos;s already waiting for a {theme} battle.</p>
                <p className="mt-1 text-sm text-muted">Take their challenge, or keep going to post your own.</p>
                <div className="mt-3 flex gap-2">
                  <LinkButton href={`/battle/${match.id}`} size="sm">
                    See their challenge
                  </LinkButton>
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setMatch("none");
                      setStep(3);
                    }}
                  >
                    Post my own
                  </Btn>
                </div>
              </Card>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-sm text-muted">
              {type === "SONG_FOR_SONG"
                ? `Pick ${rounds} songs, one per round. Your opponent won't see them until each round drops.`
                : type === "PLAYLIST"
                  ? `Pick ${playlistLength} tracks for your playlist.`
                  : "Upload your mix."}
              {(era.from || era.to) && ` Era: ${era.from ?? "any"}–${era.to ?? "now"}.`}
            </p>
            {type === "DJ_MIX" ? (
              canUpload ? (
                <MixUpload onReady={setUploadId} />
              ) : (
                <FormMessage>Mix uploads aren&apos;t set up on this server yet. Pick another format.</FormMessage>
              )
            ) : canSearch ? (
              <SongPicker size={lineupSize} value={picks} onChange={setPicks} era={era} {...(type === "PLAYLIST" ? { slotLabel: (i: number) => `Track ${i + 1}` } : {})} />
            ) : (
              <FormMessage>Music search isn&apos;t set up on this server yet.</FormMessage>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <Card>
              <p className="text-xs uppercase tracking-widest text-muted">
                {BATTLE_TYPE_LABELS[type]} · {type === "SONG_FOR_SONG" ? `${rounds} rounds` : type === "PLAYLIST" ? `${playlistLength} tracks` : "1 mix"}
              </p>
              <p className="mt-1 font-display text-2xl font-bold uppercase">{theme}</p>
              <p className="mt-1 text-sm text-muted">
                @{me} vs {mode === "DIRECT" ? `@${opponent.replace(/^@/, "")}` : mode === "OPEN" ? "anyone who accepts" : "your matched opponent"}
              </p>
            </Card>
            <TextArea
              label="Talk your talk (optional)"
              name="tagline"
              rows={2}
              maxLength={120}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder={mode === "OPEN" ? `Nobody can beat my ${theme} picks` : "Bring your best."}
              error={fields.tagline}
            />

            <button type="button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced} className="text-sm font-medium text-violet-soft">
              {advanced ? "Fewer options" : "More options"}
            </button>
            {advanced && (
              <div className="space-y-4 rounded-2xl border border-line p-4">
                <Field label="Title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={`${theme} battle`} error={fields.title} />
                <Select label="Genre" name="genre" value={genre} onChange={(e) => setGenre(e.target.value)} error={fields.genre}>
                  <option value="">Any</option>
                  {GENRES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Era from" name="eraFrom" inputMode="numeric" value={eraFrom} onChange={(e) => setEraFrom(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Any" error={fields.eraFrom} />
                  <Field label="Era to" name="eraTo" inputMode="numeric" value={eraTo} onChange={(e) => setEraTo(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Now" error={fields.eraTo} />
                </div>
                <ChoiceGroup<"PUBLIC" | "PRIVATE">
                  legend="Who can see it"
                  name="visibility"
                  columns={2}
                  value={visibility}
                  onChange={setVisibility}
                  options={[
                    { value: "PUBLIC", label: "Public", hint: "Listed for everyone" },
                    { value: "PRIVATE", label: "Private", hint: "Only people with the link" },
                  ]}
                />
                <Select label="Voting stays open" name="voting" value={votingMs} onChange={(e) => setVotingMs(Number(e.target.value))}>
                  {VOTING_DURATIONS.map((d) => (
                    <option key={d.ms} value={d.ms}>
                      {d.label}
                    </option>
                  ))}
                </Select>
                {type === "SONG_FOR_SONG" && (
                  <Select label="Round reveal" name="reveal" value={revealMs} onChange={(e) => setRevealMs(Number(e.target.value))} error={fields.revealIntervalMs}>
                    {REVEAL_INTERVALS.map((d) => (
                      <option key={d.ms} value={d.ms}>
                        {d.label}
                      </option>
                    ))}
                  </Select>
                )}
                <Field
                  label="Premiere time (optional)"
                  name="premiere"
                  type="datetime-local"
                  value={premiere}
                  onChange={(e) => setPremiere(e.target.value)}
                  hint="Rounds go live at this time once both lineups are in."
                  error={fields.scheduledFor}
                />
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={hideTotals} onChange={(e) => setHideTotals(e.target.checked)} className="size-4 accent-violet" />
                  Hide vote counts until people vote
                </label>
              </div>
            )}
          </>
        )}

        {error && <FormMessage>{error}</FormMessage>}

        <div className="flex gap-3 pt-2">
          {step > 0 && !(rematch && step === 3) && (
            <Btn variant="ghost" onClick={back} disabled={pending}>
              Back
            </Btn>
          )}
          {step < STEPS.length - 1 ? (
            <Btn block onClick={next} disabled={!canNext() || pending || (step === 2 && match !== null && match !== "none")}>
              {pending ? "Looking…" : step === 2 && mode === "MATCHMAKING" && match === null ? "Find opponent" : "Next"}
            </Btn>
          ) : (
            <Btn block size="lg" onClick={submit} disabled={pending}>
              {pending ? "Sending…" : mode === "OPEN" || mode === "MATCHMAKING" ? "Post challenge" : `Challenge @${opponent.replace(/^@/, "")}`}
            </Btn>
          )}
        </div>
        {step === 0 && (
          <p className="text-center text-xs text-muted">
            Or browse <Link href="/battle" className="underline underline-offset-2">open challenges</Link> and accept one.
          </p>
        )}
      </div>
    </div>
  );
}
