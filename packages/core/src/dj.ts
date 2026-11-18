import type { UserSummary } from "./api";

/**
 * DJ Vybz Studio, DJ University and DJ battles: shared definitions.
 *
 * Audio rule: the studio only plays audio people may manipulate. That's the
 * VYBZ pack (original tracks VYBZ owns and licenses for mixing, recording and
 * battles) and files people load from their own device after confirming they
 * have the rights. Device files never leave the device. Streaming-service
 * audio (Apple Music, YouTube) is never loaded into the studio.
 */

// ── The VYBZ pack ──────────────────────────────────────────────────────────

export interface PackTrack {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  /** Musical key, e.g. "Am". */
  key: string;
  /** Camelot code for harmonic mixing, e.g. "8A". */
  camelot: string;
  /** Rough energy, 1 (chill) to 10 (peak time). */
  energy: number;
  genre: string;
  /** Bars of beat-only intro and outro (32 bars in all). */
  introBars: number;
  outroBars: number;
  /** Served from the web app's /studio/pack/. */
  file: string;
}

const pt = (id: string, title: string, bpm: number, key: string, camelot: string, energy: number, genre: string): PackTrack => ({
  id,
  title,
  artist: "VYBZ Studio",
  bpm,
  key,
  camelot,
  energy,
  genre,
  introBars: 8,
  outroBars: 8,
  file: `/studio/pack/${id}.mp3`,
});

export const VYBZ_PACK: readonly PackTrack[] = [
  pt("gold-teeth", "Gold Teeth", 92, "Cm", "5A", 3, "Hip-Hop"),
  pt("low-sun", "Low Sun", 112, "Dm", "7A", 5, "Afro house"),
  pt("velvet-hours", "Velvet Hours", 120, "Fm", "4A", 4, "Deep house"),
  pt("neon-drift", "Neon Drift", 124, "Am", "8A", 6, "House"),
  pt("night-shift", "Night Shift", 126, "Am", "8A", 7, "UK garage"),
  pt("pressure-cooker", "Pressure Cooker", 130, "Em", "9A", 8, "Techno"),
  pt("skyline", "Skyline", 140, "F#m", "11A", 8, "Dubstep"),
  pt("rush-hour", "Rush Hour", 174, "Bbm", "3A", 9, "Drum & bass"),
];

export function packTrack(id: string): PackTrack | undefined {
  return VYBZ_PACK.find((t) => t.id === id);
}

/** Camelot neighbours mix cleanly: same code, ±1 number, or the relative major/minor. */
export function camelotCompatible(a: string, b: string): boolean {
  const pa = /^(\d{1,2})([AB])$/.exec(a);
  const pb = /^(\d{1,2})([AB])$/.exec(b);
  if (!pa || !pb) return false;
  const na = Number(pa[1]);
  const nb = Number(pb[1]);
  if (pa[2] === pb[2]) {
    const d = Math.abs(na - nb);
    return d === 0 || d === 1 || d === 11;
  }
  return na === nb;
}

/** Tempos within this share of each other can be matched with the pitch fader. */
export function tempoCompatible(a: number, b: number, range = 0.08): boolean {
  const r = (x: number, y: number) => Math.abs(x - y) / y <= range;
  return r(a, b) || r(a, b * 2) || r(a * 2, b);
}

// ── Sets ───────────────────────────────────────────────────────────────────

export type DjSetKind = "SET" | "BATTLE";
export type DjTrackRef = { source: "VYBZ"; id: string } | { source: "LOCAL"; hash: string; title: string; durationMs: number; bpm: number | null };

export type DjEventKind = "load" | "play" | "pause" | "seek" | "cue" | "setcue" | "tempo" | "vol" | "eq" | "filter" | "xf" | "end";
/** One recorded move. t: ms from the start of the recording; d: deck; v: value; b: EQ band. */
export interface DjEvent {
  t: number;
  k: DjEventKind;
  d?: "A" | "B";
  v?: number;
  b?: "low" | "mid" | "high";
}

export interface DjSetStats {
  transitions: number;
  /** Share of time with both decks audible where they were beatmatched (0–100), or null with no overlap. */
  beatmatchPct: number | null;
  /** Longest stretch of silence, ms. */
  longestSilenceMs: number;
  averageBpm: number | null;
}

export const DJ_LIMITS = {
  maxEvents: 6000,
  maxTracks: 20,
  maxSetMs: 60 * 60_000,
  battleMinMs: 30_000,
  battleMaxMs: 180_000,
  titleMax: 80,
} as const;

export interface DjSetView {
  id: string;
  title: string;
  kind: DjSetKind;
  owner: UserSummary;
  tracks: DjTrackRef[];
  /** VYBZ pack only, so anyone can play it back. Required for battle sets. */
  vybzOnly: boolean;
  durationMs: number;
  stats: DjSetStats;
  createdAt: string;
  /** Only for the owner, or when the set is in a DJ battle. */
  events?: DjEvent[];
}

export interface DjSetInput {
  title: string;
  kind: DjSetKind;
  tracks: DjTrackRef[];
  events: DjEvent[];
  durationMs: number;
  stats: DjSetStats;
}

// ── DJ battles ─────────────────────────────────────────────────────────────

export type DjBattleStatus = "OPEN" | "VOTING" | "COMPLETE" | "CANCELLED";

export const DJ_BATTLE = {
  votingMs: 24 * 3600_000,
  /** Listen to this much of each set before voting. */
  listenShare: 0.8,
  winXp: 60,
  winCoins: 20,
  playXp: 25,
} as const;

export interface DjBattleSide {
  dj: UserSummary;
  set: DjSetView;
  votes: number | null;
}

export interface DjBattleView {
  id: string;
  title: string;
  status: DjBattleStatus;
  a: DjBattleSide;
  b: DjBattleSide | null;
  votingEndsAt: string | null;
  winner: "A" | "B" | "DRAW" | null;
  myVote: "A" | "B" | null;
  canJoin: boolean;
  canVote: boolean;
  createdAt: string;
}

// ── DJ University ──────────────────────────────────────────────────────────

export type PracticeCheck =
  | { type: "transport" }
  | { type: "tapTempo"; toleranceBpm: number }
  | { type: "beatmatch"; holdMs: number; maxBpmDiff: number; maxPhaseMs: number }
  | { type: "cue"; maxOffBeatMs: number }
  | { type: "crossfade"; minMs: number }
  | { type: "eqSwap"; holdMs: number }
  | { type: "transition"; minOverlapMs: number; maxBpmDiff: number }
  | { type: "selection" }
  | { type: "energy"; tracks: number }
  | { type: "crowd"; holdMs: number; minEnergy: number }
  | { type: "battleSet"; minTransitions: number };

export interface PracticeSpec {
  goal: string;
  steps: string[];
  /** Pack tracks put on the decks before the exercise. */
  setup: { A?: string; B?: string; playA?: boolean; bTempo?: number };
  check: PracticeCheck;
  /** Hide the Sync button (it would do the exercise for you). */
  noSync?: boolean;
}

export interface DemoStep {
  /** ms from the start of the demo. */
  at: number;
  caption: string;
  /** Moves the studio performs, in recorded-event form. */
  moves?: Omit<DjEvent, "t">[];
}

export interface LessonQuizQuestion {
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
}

export interface DjLesson {
  id: string;
  course: string;
  order: number;
  title: string;
  icon: string;
  summary: string;
  learn: { heading: string; body: string }[];
  terms: { term: string; meaning: string }[];
  demo: { setup: PracticeSpec["setup"]; steps: DemoStep[] };
  practice: PracticeSpec;
  quiz: LessonQuizQuestion[];
  xp: number;
  coins: number;
}

const ms = (s: number) => Math.round(s * 1000);

/** Same order everywhere, so the right answer isn't always first. */
function shuffleQuiz(lesson: DjLesson): DjLesson {
  const hash = (x: string) => {
    let h = 2166136261;
    for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  return {
    ...lesson,
    quiz: lesson.quiz.map((q) => {
      const order = q.choices.map((c, i) => ({ c, i, k: hash(`${q.prompt}:${c}`) })).sort((a, b) => a.k - b.k);
      return { ...q, choices: order.map((o) => o.c), answerIndex: order.findIndex((o) => o.i === q.answerIndex) };
    }),
  };
}

const LESSONS: DjLesson[] = [
  {
    id: "basics",
    course: "DJ Basics",
    order: 1,
    title: "Meet the decks",
    icon: "🎛️",
    summary: "Two decks, a mixer and a crossfader: what each part does and how a mix flows.",
    learn: [
      { heading: "Two decks, one mix", body: "A DJ plays music on two decks, A and B. One deck plays to the crowd while you get the next track ready on the other. Then you blend from one to the other so the music never stops." },
      { heading: "The mixer", body: "Each deck has its own channel on the mixer: a volume fader, EQ knobs to shape the sound, and a filter. The crossfader in the middle slides the mix between deck A and deck B." },
      { heading: "Transport", body: "Play and pause start and stop a deck. Cue is a bookmark: press it to jump back to your cue point. The track timer shows how far in you are and how long is left, so you're never caught out by a track ending." },
    ],
    terms: [
      { term: "Deck", meaning: "One of the two players you mix between." },
      { term: "Crossfader", meaning: "The slider that blends deck A into deck B." },
      { term: "Cue", meaning: "A saved point in a track you can jump back to." },
    ],
    demo: {
      setup: { A: "neon-drift", B: "night-shift" },
      steps: [
        { at: 0, caption: "Deck A has Neon Drift loaded. Press play to start it.", moves: [{ k: "xf", v: -1 }, { k: "play", d: "A" }] },
        { at: ms(4), caption: "The waveform scrolls and the timer counts down how much is left." },
        { at: ms(8), caption: "Pause stops the deck where it is.", moves: [{ k: "pause", d: "A" }] },
        { at: ms(10), caption: "Cue jumps back to the start (the cue point) and plays.", moves: [{ k: "cue", d: "A" }] },
        { at: ms(14), caption: "The volume fader sets how loud deck A is in the mix.", moves: [{ k: "vol", d: "A", v: 0.6 }] },
        { at: ms(17), caption: "Back up to full.", moves: [{ k: "vol", d: "A", v: 1 }] },
        { at: ms(20), caption: "That's the deck. Your turn.", moves: [{ k: "pause", d: "A" }] },
      ],
    },
    practice: {
      goal: "Load a track, play it, pause it, then start it again with Cue.",
      steps: ["Load any track on deck A from the library.", "Press Play.", "Press Pause.", "Press Cue to jump back and play."],
      setup: {},
      check: { type: "transport" },
    },
    quiz: [
      { prompt: "What does the crossfader do?", choices: ["Blends between deck A and deck B", "Changes a track's key", "Saves a cue point", "Records your mix"], answerIndex: 0, explanation: "It slides the mix from one deck to the other." },
      { prompt: "While deck A plays to the crowd, what's deck B for?", choices: ["Getting the next track ready", "Playing the same track louder", "Nothing until A ends", "Recording the crowd"], answerIndex: 0, explanation: "You prepare the next track on the other deck, then blend it in." },
      { prompt: "What does pressing Cue do?", choices: ["Jumps back to your saved point", "Skips to the next track", "Speeds the track up", "Kills the bass"], answerIndex: 0, explanation: "A cue point is a bookmark you can return to instantly." },
    ],
    xp: 40,
    coins: 10,
  },
  {
    id: "bpm",
    course: "BPM",
    order: 2,
    title: "Feel the tempo",
    icon: "🥁",
    summary: "What BPM means, typical tempos by genre, and finding a track's tempo by ear.",
    learn: [
      { heading: "Beats per minute", body: "BPM is a track's tempo: how many beats happen in a minute. Most dance music has a steady kick drum on every beat, which makes it easy to count." },
      { heading: "Tempo by genre", body: "Hip-hop often sits around 85–100 BPM, house around 120–128, techno 125–140, dubstep around 140 and drum & bass around 170–180. Tracks close in BPM are the easiest to mix." },
      { heading: "Tap tempo", body: "When you don't know a track's BPM, tap along to the kick drum. After eight or so taps you'll have a good estimate. Half and double time matter too: a 87 BPM hip-hop beat sits neatly against 174 BPM drum & bass." },
    ],
    terms: [
      { term: "BPM", meaning: "Beats per minute: a track's tempo." },
      { term: "Downbeat", meaning: "The first beat of a bar, usually the strongest." },
      { term: "Half time", meaning: "A groove that feels half as fast as the BPM." },
    ],
    demo: {
      setup: { A: "gold-teeth", B: "rush-hour" },
      steps: [
        { at: 0, caption: "Gold Teeth is a 92 BPM hip-hop beat. Count the kick and snare.", moves: [{ k: "xf", v: -1 }, { k: "play", d: "A" }] },
        { at: ms(7), caption: "Now Neon Drift: house at 124 BPM. Same four beats a bar, more of them each minute.", moves: [{ k: "pause", d: "A" }, { k: "load", d: "B", v: 3 }, { k: "xf", v: 1 }, { k: "play", d: "B" }] },
        { at: ms(14), caption: "The BPM readout on each deck shows the tempo. Tap along with the Tap button to measure it yourself.", moves: [] },
        { at: ms(20), caption: "Tap with the kick on every beat. Your turn.", moves: [{ k: "pause", d: "B" }] },
      ],
    },
    practice: {
      goal: "Tap the tempo of the track on deck A to within 3 BPM.",
      steps: ["Press Play on deck A.", "Tap the Tap button with every kick drum, at least 8 times.", "Your tapped BPM shows on the deck. Get within 3 BPM of the real tempo."],
      setup: { A: "velvet-hours", playA: true },
      check: { type: "tapTempo", toleranceBpm: 3 },
      noSync: true,
    },
    quiz: [
      { prompt: "What does BPM measure?", choices: ["Beats per minute", "Bass per mix", "Bars per measure", "Bytes per minute"], answerIndex: 0, explanation: "Tempo: beats in one minute." },
      { prompt: "Which tempo is typical for house music?", choices: ["About 124 BPM", "About 70 BPM", "About 174 BPM", "About 200 BPM"], answerIndex: 0, explanation: "House usually runs 120–128 BPM." },
      { prompt: "Which pair sits well together in half/double time?", choices: ["87 and 174 BPM", "100 and 130 BPM", "120 and 150 BPM", "90 and 140 BPM"], answerIndex: 0, explanation: "174 is exactly double 87." },
    ],
    xp: 40,
    coins: 10,
  },
  {
    id: "beatmatching",
    course: "Beatmatching",
    order: 3,
    title: "Lock two beats together",
    icon: "🔗",
    summary: "Match the tempo with the pitch fader, then line up the beats by ear and eye.",
    learn: [
      { heading: "Two steps", body: "Beatmatching means making two tracks play at the same tempo with their beats landing together. First match the speed with the tempo (pitch) fader, then line up the beats so the kicks hit at the same moment." },
      { heading: "Speed", body: "If deck B is at 126 BPM and deck A at 124, slow B down by about 1.6%. Watch the BPM readout, but trust your ears: if the kicks drift apart over a few bars, the speeds still don't match." },
      { heading: "Phase", body: "With the speeds matched, nudge the incoming track so its kick lands on deck A's kick. Galloping kicks (a 'flam') mean you're slightly off. The phase meter shows how far apart the beats are." },
    ],
    terms: [
      { term: "Pitch / tempo fader", meaning: "Speeds a deck up or slows it down." },
      { term: "Phase", meaning: "Whether two beats land together." },
      { term: "Train wreck", meaning: "Two tracks clashing out of time." },
    ],
    demo: {
      setup: { A: "neon-drift", B: "night-shift" },
      steps: [
        { at: 0, caption: "Deck A: Neon Drift at 124 BPM is playing.", moves: [{ k: "xf", v: -1 }, { k: "play", d: "A" }] },
        { at: ms(4), caption: "Deck B: Night Shift is 126 BPM. Start it in the headphones (crossfader still on A).", moves: [{ k: "play", d: "B" }] },
        { at: ms(8), caption: "Slow deck B by about 1.6% so both read 124 BPM.", moves: [{ k: "tempo", d: "B", v: 124 / 126 }] },
        { at: ms(12), caption: "Line the kicks up: jump deck B to the same beat position as deck A.", moves: [{ k: "seek", d: "B", v: -1 }] },
        { at: ms(16), caption: "Bring the crossfader to the middle. The kicks land together: beatmatched.", moves: [{ k: "xf", v: 0 }] },
        { at: ms(26), caption: "Now try it without the Sync button.", moves: [{ k: "xf", v: -1 }, { k: "pause", d: "B" }] },
      ],
    },
    practice: {
      goal: "Beatmatch deck B to deck A and keep them locked for 8 seconds.",
      steps: ["Deck A is already playing at 124 BPM.", "Play deck B and use its tempo fader until it reads 124.", "Nudge deck B (the ◀ ▶ buttons) until the phase meter is centred.", "Hold it for 8 seconds with both decks audible."],
      setup: { A: "neon-drift", B: "night-shift", playA: true },
      check: { type: "beatmatch", holdMs: 8000, maxBpmDiff: 0.3, maxPhaseMs: 45 },
      noSync: true,
    },
    quiz: [
      { prompt: "Deck A is 124 BPM, deck B 126 BPM. What do you do to deck B?", choices: ["Slow it down about 1.6%", "Speed it up 2%", "Turn its volume down", "Cut its bass"], answerIndex: 0, explanation: "124/126 ≈ 0.984: about 1.6% slower." },
      { prompt: "You hear the kicks 'galloping'. What's wrong?", choices: ["The beats are slightly out of phase", "The tracks are in different keys", "The volume is too high", "Nothing, that's the groove"], answerIndex: 0, explanation: "A flam means the kicks land just apart." },
      { prompt: "Beatmatching needs which two things to match?", choices: ["Tempo and phase", "Key and volume", "Genre and year", "EQ and filter"], answerIndex: 0, explanation: "Same speed, beats lined up." },
    ],
    xp: 50,
    coins: 15,
  },
  {
    id: "cue-points",
    course: "Cue Points",
    order: 4,
    title: "Start on the one",
    icon: "📍",
    summary: "Set cue points on downbeats so tracks come in exactly where you want.",
    learn: [
      { heading: "Why cue points", body: "A cue point marks where you want a track to start, usually the first beat of a phrase. Set it while the deck is paused, then press Cue to start from exactly that spot every time." },
      { heading: "Phrases", body: "Dance music moves in phrases of 8, 16 and 32 bars. Start the incoming track on the first beat of a phrase so its changes line up with the outgoing track's." },
      { heading: "Grid", body: "The beat grid lines on the waveform mark every beat; the bright ones are bar starts. Snap your cue to a bright line." },
    ],
    terms: [
      { term: "Cue point", meaning: "A saved start position." },
      { term: "Phrase", meaning: "A musical section, usually 8, 16 or 32 bars." },
      { term: "Bar", meaning: "Four beats." },
    ],
    demo: {
      setup: { A: "pressure-cooker" },
      steps: [
        { at: 0, caption: "Play deck A and listen for where the chords come in.", moves: [{ k: "xf", v: -1 }, { k: "play", d: "A" }] },
        { at: ms(6), caption: "Jump to bar 9, where the main section starts, and pause.", moves: [{ k: "pause", d: "A" }, { k: "seek", d: "A", v: (60 / 130) * 4 * 8 * 1000 }] },
        { at: ms(9), caption: "Set the cue point here. It snaps to the nearest beat.", moves: [{ k: "setcue", d: "A", v: (60 / 130) * 4 * 8 * 1000 }] },
        { at: ms(12), caption: "Press Cue: it starts right on the phrase.", moves: [{ k: "cue", d: "A" }] },
        { at: ms(20), caption: "Your turn.", moves: [{ k: "pause", d: "A" }] },
      ],
    },
    practice: {
      goal: "Set a cue point on a beat on deck B, then start the track from it.",
      steps: ["Seek deck B somewhere into the track with the waveform.", "Press Set cue (it snaps to the beat grid).", "Press Cue to play from it."],
      setup: { B: "low-sun" },
      check: { type: "cue", maxOffBeatMs: 30 },
    },
    quiz: [
      { prompt: "Where should a cue point usually go?", choices: ["On the first beat of a phrase", "Halfway through a bar", "At the end of the track", "Anywhere, it doesn't matter"], answerIndex: 0, explanation: "Phrase starts keep the mix in step with the music's structure." },
      { prompt: "How many beats are in a bar of most dance music?", choices: ["4", "3", "8", "16"], answerIndex: 0, explanation: "Four beats to a bar." },
      { prompt: "Common phrase lengths in dance music are…", choices: ["8, 16 or 32 bars", "3, 5 or 7 bars", "1 bar only", "Random"], answerIndex: 0, explanation: "Phrases are built in powers of two." },
    ],
    xp: 40,
    coins: 10,
  },
  {
    id: "crossfading",
    course: "Crossfading",
    order: 5,
    title: "Smooth hand-offs",
    icon: "↔️",
    summary: "Move from one deck to the other without a bump in volume.",
    learn: [
      { heading: "Slow and steady", body: "A smooth blend moves the crossfader gradually over 8 or 16 bars, so the crowd hears one track turn into the other." },
      { heading: "Volume faders too", body: "Many DJs leave the crossfader in the middle and blend with the channel volume faders instead. Either way, aim for steady overall loudness." },
      { heading: "Quick cuts", body: "In hip-hop and battles a fast cut on the crossfader is a move of its own. Do it on a downbeat so it sounds deliberate." },
    ],
    terms: [
      { term: "Blend", meaning: "Two tracks playing together during a transition." },
      { term: "Cut", meaning: "An instant switch from one deck to the other." },
    ],
    demo: {
      setup: { A: "neon-drift", B: "night-shift", bTempo: 124 / 126 },
      steps: [
        { at: 0, caption: "Deck A plays, deck B is beatmatched and waiting.", moves: [{ k: "xf", v: -1 }, { k: "play", d: "A" }, { k: "play", d: "B" }, { k: "seek", d: "B", v: -1 }] },
        { at: ms(4), caption: "Slide the crossfader a little at a time…", moves: [{ k: "xf", v: -0.5 }] },
        { at: ms(8), caption: "…through the middle…", moves: [{ k: "xf", v: 0 }] },
        { at: ms(12), caption: "…and on to deck B.", moves: [{ k: "xf", v: 0.5 }] },
        { at: ms(16), caption: "Deck B has the floor.", moves: [{ k: "xf", v: 1 }] },
        { at: ms(20), caption: "Your turn: take it slowly, at least 8 seconds.", moves: [{ k: "pause", d: "A" }, { k: "pause", d: "B" }] },
      ],
    },
    practice: {
      goal: "With both decks playing, move the crossfader from A to B over at least 8 seconds.",
      steps: ["Both decks are loaded and matched. Press Play on both.", "Start with the crossfader fully left (A).", "Move it steadily to fully right (B), taking 8 seconds or more."],
      setup: { A: "neon-drift", B: "night-shift", bTempo: 124 / 126, playA: true },
      check: { type: "crossfade", minMs: 8000 },
    },
    quiz: [
      { prompt: "How long does a smooth house blend usually take?", choices: ["8 to 16 bars", "Half a beat", "2 seconds", "The whole track"], answerIndex: 0, explanation: "Long blends feel seamless." },
      { prompt: "When does a fast crossfader cut sound best?", choices: ["On a downbeat", "Mid-word in a vocal", "At random", "During silence"], answerIndex: 0, explanation: "Cutting on the one sounds intentional." },
      { prompt: "What should overall loudness do during a blend?", choices: ["Stay steady", "Jump up", "Drop to silence", "Pulse"], answerIndex: 0, explanation: "Avoid bumps and dips." },
    ],
    xp: 40,
    coins: 10,
  },
  {
    id: "eq",
    course: "EQ",
    order: 6,
    title: "Swap the bass",
    icon: "🎚️",
    summary: "Use low, mid and high EQ to blend without muddy, clashing basslines.",
    learn: [
      { heading: "Three bands", body: "Low controls kick and bass, mid controls vocals, chords and snares, high controls hats and air. Turning a band down cuts it; all the way down is a 'kill'." },
      { heading: "Never two basslines", body: "Two full basslines at once sound muddy and loud. Bring the new track in with its low cut, then swap: cut the old track's lows as you open the new one's." },
      { heading: "Swap on the phrase", body: "Do the bass swap on the first beat of a new phrase so the change feels like part of the music." },
    ],
    terms: [
      { term: "EQ", meaning: "Equaliser: turns frequency bands up or down." },
      { term: "Kill", meaning: "A band turned all the way down." },
      { term: "Bass swap", meaning: "Handing the low end from one track to the other." },
    ],
    demo: {
      setup: { A: "neon-drift", B: "night-shift", bTempo: 124 / 126 },
      steps: [
        { at: 0, caption: "Deck B comes in with its bass cut.", moves: [{ k: "xf", v: 0 }, { k: "eq", d: "B", b: "low", v: -26 }, { k: "play", d: "A" }, { k: "play", d: "B" }, { k: "seek", d: "B", v: -1 }] },
        { at: ms(6), caption: "Hear how B's chords and hats sit over A's bassline.", moves: [] },
        { at: ms(11), caption: "Swap: cut A's low and open B's low together, on the downbeat.", moves: [{ k: "eq", d: "A", b: "low", v: -26 }, { k: "eq", d: "B", b: "low", v: 0 }] },
        { at: ms(18), caption: "Now B carries the bass. Fade A out.", moves: [{ k: "xf", v: 1 }] },
        { at: ms(24), caption: "Your turn.", moves: [{ k: "pause", d: "A" }, { k: "pause", d: "B" }, { k: "eq", d: "A", b: "low", v: 0 }] },
      ],
    },
    practice: {
      goal: "During a blend, keep deck A's low cut (−12 dB or lower) and deck B's low open for 4 seconds.",
      steps: ["Play both decks with the crossfader in the middle.", "Turn deck A's LOW down to −12 dB or lower.", "Keep deck B's LOW at 0 dB or above.", "Hold for 4 seconds."],
      setup: { A: "neon-drift", B: "night-shift", bTempo: 124 / 126, playA: true },
      check: { type: "eqSwap", holdMs: 4000 },
    },
    quiz: [
      { prompt: "Which EQ band holds the kick and bassline?", choices: ["Low", "Mid", "High", "None"], answerIndex: 0, explanation: "The low band." },
      { prompt: "Why avoid two full basslines at once?", choices: ["They clash and get muddy and loud", "It's against the rules", "It changes the key", "It slows the tempo"], answerIndex: 0, explanation: "Low frequencies stack up fast." },
      { prompt: "When should the bass swap happen?", choices: ["On the first beat of a phrase", "Mid-bar", "After the track ends", "Never"], answerIndex: 0, explanation: "It lands as part of the music." },
    ],
    xp: 50,
    coins: 15,
  },
  {
    id: "transitions",
    course: "Transitions",
    order: 7,
    title: "Your first full mix",
    icon: "🌉",
    summary: "Put it together: cue, beatmatch, blend, swap and finish on the new track.",
    learn: [
      { heading: "The recipe", body: "Cue the new track on a phrase. Start it on the downbeat, beatmatch it, bring it in with its bass cut, swap the bass on the next phrase, then fade the old track out." },
      { heading: "Use the outro", body: "Mix out of the outgoing track's outro and into the new track's intro. VYBZ pack tracks have 8-bar beat-only intros and outros made for this." },
      { heading: "Other styles", body: "Not every transition is a long blend: a filter sweep, an echo-out or a quick cut can all work when the tracks are too different to blend." },
    ],
    terms: [
      { term: "Intro / outro", meaning: "The DJ-friendly start and end of a track." },
      { term: "Overlap", meaning: "The time both tracks play together." },
    ],
    demo: {
      setup: { A: "velvet-hours", B: "neon-drift", bTempo: 120 / 124 },
      steps: [
        { at: 0, caption: "Velvet Hours plays on A. Neon Drift is cued on B, matched to 120 BPM.", moves: [{ k: "xf", v: -1 }, { k: "play", d: "A" }] },
        { at: ms(4), caption: "On the downbeat, start B with its bass cut.", moves: [{ k: "eq", d: "B", b: "low", v: -26 }, { k: "play", d: "B" }, { k: "seek", d: "B", v: -1 }, { k: "xf", v: 0 }] },
        { at: ms(12), caption: "Bass swap.", moves: [{ k: "eq", d: "A", b: "low", v: -26 }, { k: "eq", d: "B", b: "low", v: 0 }] },
        { at: ms(18), caption: "Fade A out…", moves: [{ k: "xf", v: 0.6 }] },
        { at: ms(22), caption: "…and B has the floor. Bring B back to its real tempo slowly if you like.", moves: [{ k: "xf", v: 1 }, { k: "pause", d: "A" }, { k: "eq", d: "A", b: "low", v: 0 }] },
        { at: ms(28), caption: "Your turn.", moves: [{ k: "pause", d: "B" }] },
      ],
    },
    practice: {
      goal: "Mix from deck A to deck B: at least 8 seconds of beatmatched overlap, ending with only B playing.",
      steps: ["A is playing. Get B beatmatched.", "Bring B in and blend for at least 8 seconds.", "Finish with A paused or faded out and B playing."],
      setup: { A: "velvet-hours", B: "neon-drift", playA: true },
      check: { type: "transition", minOverlapMs: 8000, maxBpmDiff: 0.5 },
    },
    quiz: [
      { prompt: "Where should you mix out of the outgoing track?", choices: ["Its outro", "Its first chorus", "Its quietest bar", "Anywhere"], answerIndex: 0, explanation: "Outros are made for mixing." },
      { prompt: "What comes right after starting the new track?", choices: ["Beatmatch it", "Turn it up fully", "Stop the old track", "Change the key"], answerIndex: 0, explanation: "Match it before the crowd hears it." },
      { prompt: "Two tracks are too different to blend. What can work?", choices: ["A filter sweep, echo-out or quick cut", "Playing them both at full volume", "Stopping the music for a minute", "Nothing"], answerIndex: 0, explanation: "Short transitions avoid a clash." },
    ],
    xp: 60,
    coins: 20,
  },
  {
    id: "selection",
    course: "Song Selection",
    order: 8,
    title: "What plays next",
    icon: "🗂️",
    summary: "Pick the next track by tempo, key and feel so it blends and lifts the room.",
    learn: [
      { heading: "Tempo first", body: "Choose tracks within about 6–8% of the current BPM so you can match them without the music sounding sped up or slowed down." },
      { heading: "Key", body: "Tracks in compatible keys sound good together. The Camelot wheel makes it easy: the same code, one number either side, or the same number with the other letter." },
      { heading: "Feel", body: "Tempo and key are a start; the vibe matters most. Think about the energy, the sound and what the room wants next." },
    ],
    terms: [
      { term: "Harmonic mixing", meaning: "Blending tracks in compatible keys." },
      { term: "Camelot code", meaning: "A key written as a number and letter, like 8A." },
    ],
    demo: {
      setup: { A: "neon-drift" },
      steps: [
        { at: 0, caption: "Neon Drift: 124 BPM, key 8A. What could follow?", moves: [{ k: "xf", v: -1 }, { k: "play", d: "A" }] },
        { at: ms(6), caption: "Night Shift: 126 BPM and also 8A. Close tempo, same key: a natural next track.", moves: [{ k: "load", d: "B", v: 4 }] },
        { at: ms(12), caption: "Rush Hour at 174 BPM in 3A is too far in tempo and key for a long blend.", moves: [] },
        { at: ms(18), caption: "Your turn: pick a track that fits.", moves: [{ k: "pause", d: "A" }] },
      ],
    },
    practice: {
      goal: "Deck A has Neon Drift (124 BPM, 8A). Load a track on deck B that's within 8% in tempo and in a compatible key.",
      steps: ["Check deck A's BPM and key.", "Browse the library: each track shows its BPM and Camelot key.", "Load a compatible track on deck B."],
      setup: { A: "neon-drift" },
      check: { type: "selection" },
    },
    quiz: [
      { prompt: "Which Camelot codes mix well with 8A?", choices: ["7A, 8A, 9A and 8B", "3A and 3B", "Only 8A", "Any code"], answerIndex: 0, explanation: "Same code, ±1, or the relative major." },
      { prompt: "A track is 124 BPM. Which is the easiest to blend next?", choices: ["126 BPM", "174 BPM", "92 BPM", "150 BPM"], answerIndex: 0, explanation: "Within about 2%." },
      { prompt: "Beyond tempo and key, what matters most?", choices: ["The feel and what the room wants", "The file size", "Alphabetical order", "Track length"], answerIndex: 0, explanation: "Selection is about the vibe." },
    ],
    xp: 40,
    coins: 10,
  },
  {
    id: "energy",
    course: "Building Energy",
    order: 9,
    title: "Shape the night",
    icon: "📈",
    summary: "Plan a run of tracks that builds, peaks and lets the room breathe.",
    learn: [
      { heading: "Waves, not a straight line", body: "A good set rises and falls. Build energy over a few tracks, hit a peak, then give the room a breather before building again." },
      { heading: "What raises energy", body: "Higher tempo, harder drums, bigger basslines and brighter sounds. Small steps work better than jumps." },
      { heading: "Tools in the mix", body: "Hold back the bass and bring it in on a drop, use a filter sweep to build tension, or loop an intro to stretch the build." },
    ],
    terms: [
      { term: "Peak time", meaning: "The highest-energy part of a night." },
      { term: "Drop", meaning: "The moment the full beat and bass come back in." },
    ],
    demo: {
      setup: { A: "velvet-hours" },
      steps: [
        { at: 0, caption: "Start warm: Velvet Hours, energy 4.", moves: [{ k: "xf", v: -1 }, { k: "play", d: "A" }] },
        { at: ms(6), caption: "Step up: Neon Drift, energy 6.", moves: [{ k: "load", d: "B", v: 3 }] },
        { at: ms(10), caption: "Then Pressure Cooker, energy 8, for the peak.", moves: [] },
        { at: ms(14), caption: "A filter sweep builds tension before a drop.", moves: [{ k: "filter", d: "A", v: -0.7 }] },
        { at: ms(20), caption: "…and release.", moves: [{ k: "filter", d: "A", v: 0 }] },
        { at: ms(24), caption: "Your turn: build a run of three.", moves: [{ k: "pause", d: "A" }] },
      ],
    },
    practice: {
      goal: "Load three tracks one after another, each with the same or more energy than the last.",
      steps: ["Each library track shows its energy (1–10).", "Load three tracks in rising order across the decks."],
      setup: {},
      check: { type: "energy", tracks: 3 },
    },
    quiz: [
      { prompt: "What shape does a good set usually have?", choices: ["Waves that build and release", "Flat all night", "Peak in the first minute", "Slower and slower"], answerIndex: 0, explanation: "Build, peak, breathe, build again." },
      { prompt: "Which of these raises energy?", choices: ["Harder drums and a bit more tempo", "Killing every EQ band", "Long silences", "Lowering the master"], answerIndex: 0, explanation: "Bigger drums and pace lift a room." },
      { prompt: "What's a 'drop'?", choices: ["When the full beat and bass come back in", "When a track ends", "A crossfader cut", "A cue point"], answerIndex: 0, explanation: "The release after a build." },
    ],
    xp: 40,
    coins: 10,
  },
  {
    id: "crowd",
    course: "Reading a Crowd",
    order: 10,
    title: "Play the room",
    icon: "👀",
    summary: "Watch how people react and adjust: what to do when the floor fills or empties.",
    learn: [
      { heading: "Look up", body: "Watch the floor, not the screen. Are people dancing, singing, heading to the bar? That tells you whether to keep going or change direction." },
      { heading: "Change things up", body: "If energy dips, switch something: a familiar track, a tempo step, a different style. If it's peaking, ride it but plan your breather." },
      { heading: "Mistakes cost energy", body: "Silence and train wrecks empty floors fast. Clean transitions and steady volume keep people moving." },
    ],
    terms: [
      { term: "Floor", meaning: "The dance floor and the people on it." },
      { term: "Reading the room", meaning: "Judging what the crowd wants next." },
    ],
    demo: {
      setup: { A: "neon-drift", B: "night-shift", bTempo: 124 / 126 },
      steps: [
        { at: 0, caption: "The crowd meter shows how the room is feeling. Music playing: it rises.", moves: [{ k: "xf", v: -1 }, { k: "play", d: "A" }] },
        { at: ms(6), caption: "A clean, beatmatched blend keeps it climbing.", moves: [{ k: "play", d: "B" }, { k: "seek", d: "B", v: -1 }, { k: "xf", v: 0 }] },
        { at: ms(14), caption: "Silence makes it drop fast.", moves: [{ k: "pause", d: "A" }, { k: "pause", d: "B" }] },
        { at: ms(18), caption: "Get the music back in quickly.", moves: [{ k: "play", d: "B" }, { k: "xf", v: 1 }] },
        { at: ms(24), caption: "Your turn: keep the crowd up.", moves: [{ k: "pause", d: "B" }] },
      ],
    },
    practice: {
      goal: "Keep the crowd meter above 60% for 30 seconds.",
      steps: ["Play music and keep it going.", "Blend cleanly: beatmatched overlaps lift the crowd, clashes and silence drop it.", "Changing tracks now and then keeps it fresh."],
      setup: { A: "neon-drift", B: "night-shift" },
      check: { type: "crowd", holdMs: 30_000, minEnergy: 60 },
    },
    quiz: [
      { prompt: "People are drifting off the floor. What do you do?", choices: ["Change something: a familiar track or a tempo step", "Keep playing the same thing", "Stop the music", "Turn everything up"], answerIndex: 0, explanation: "Change direction when energy dips." },
      { prompt: "What empties a floor fastest?", choices: ["Silence and train wrecks", "A clean blend", "A cue point", "Matching BPM"], answerIndex: 0, explanation: "Mistakes cost energy." },
      { prompt: "Where should you be looking most of the time?", choices: ["At the crowd", "At the waveform", "At your phone", "At the ceiling"], answerIndex: 0, explanation: "The room tells you what to play." },
    ],
    xp: 40,
    coins: 10,
  },
  {
    id: "battle-strategy",
    course: "Battle Strategy",
    order: 11,
    title: "Win the battle",
    icon: "🏆",
    summary: "Plan a short battle set: open strong, show your skills, finish on a high.",
    learn: [
      { heading: "Short and sharp", body: "Battle sets are 30 seconds to 3 minutes. Every second counts: no long intros, no dead air." },
      { heading: "Show the skills", body: "Judges and voters listen for clean beatmatching, smart EQ, tight cuts and a story in your track choices. Two or three well-chosen transitions beat ten rushed ones." },
      { heading: "Finish big", body: "Save your strongest moment for the end: the last thing voters hear is what they remember." },
    ],
    terms: [
      { term: "Battle set", meaning: "A short recorded mix entered into a DJ battle." },
      { term: "Routine", meaning: "A planned sequence of moves." },
    ],
    demo: {
      setup: { A: "pressure-cooker", B: "skyline" },
      steps: [
        { at: 0, caption: "Open with impact: start in the main section, not the intro.", moves: [{ k: "xf", v: -1 }, { k: "seek", d: "A", v: (60 / 130) * 4 * 8 * 1000 }, { k: "play", d: "A" }] },
        { at: ms(8), caption: "A quick cut on the downbeat into something different.", moves: [{ k: "play", d: "B" }, { k: "xf", v: 1 }] },
        { at: ms(14), caption: "Use the filter to build before your finale.", moves: [{ k: "filter", d: "B", v: 0.6 }] },
        { at: ms(20), caption: "Release, and finish strong.", moves: [{ k: "filter", d: "B", v: 0 }] },
        { at: ms(26), caption: "Now record a battle set of your own.", moves: [{ k: "pause", d: "A" }, { k: "pause", d: "B" }] },
      ],
    },
    practice: {
      goal: "Record a 30–180 second battle set with at least 2 transitions and no silence longer than a second.",
      steps: ["Press Record.", "Play and mix at least three tracks (two transitions).", "Stop recording between 30 seconds and 3 minutes."],
      setup: {},
      check: { type: "battleSet", minTransitions: 2 },
    },
    quiz: [
      { prompt: "How long is a VYBZ battle set?", choices: ["30 seconds to 3 minutes", "10 minutes", "One hour", "Any length"], answerIndex: 0, explanation: "Short and sharp." },
      { prompt: "Which is better in a battle?", choices: ["Two or three clean transitions", "Ten rushed ones", "One track, no mixing", "Lots of silence"], answerIndex: 0, explanation: "Quality over quantity." },
      { prompt: "Where should your strongest moment go?", choices: ["At the end", "In the first second only", "Nowhere", "In the middle of silence"], answerIndex: 0, explanation: "Voters remember the finish." },
    ],
    xp: 60,
    coins: 20,
  },
];

export const DJ_LESSONS: readonly DjLesson[] = LESSONS.map(shuffleQuiz);

export function djLesson(id: string): DjLesson | undefined {
  return DJ_LESSONS.find((l) => l.id === id);
}

export const DJ_QUIZ_PASS = 2;

export interface DjLessonProgress {
  learned: boolean;
  watched: boolean;
  practiced: boolean;
  quizScore: number | null;
  completed: boolean;
}

export interface DjUniversityResponse {
  lessons: (Pick<DjLesson, "id" | "course" | "order" | "title" | "icon" | "summary" | "xp" | "coins"> & { progress: DjLessonProgress })[];
  completed: number;
  total: number;
}

export interface DjLessonStepResult {
  progress: DjLessonProgress;
  /** Paid when the lesson is completed for the first time. */
  reward: { xp: number; coins: number } | null;
  quiz?: { score: number; total: number; passed: boolean; answers: { correct: boolean; answerIndex: number; explanation: string }[] };
}
