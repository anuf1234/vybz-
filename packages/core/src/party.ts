/**
 * Vybz Party Mode: one screen hosts (TV or laptop), everyone plays on their
 * phones after scanning a QR code. No account needed to play; signed-in
 * players also earn XP.
 */

export type PartyGame = "TRIVIA" | "NAME_THAT_SONG" | "PLAYLIST" | "FINISH_THE_LYRICS" | "DJ_SHOWDOWN";
export type PartyPhase = "LOBBY" | "QUESTION" | "REVEAL" | "PICKING" | "VOTING" | "RESULT" | "SCORES" | "FINAL";

export const PARTY = {
  maxPlayers: 30,
  nameMax: 20,
  titleMax: 40,
  questionMs: 20_000,
  revealMs: 7_000,
  pickMs: 75_000,
  voteMs: 25_000,
  resultMs: 9_000,
  /** Points per audience vote in a playlist battle, and for voting at all. */
  votePoints: 50,
  voterPoints: 10,
  triviaRounds: [5, 10, 15] as const,
  playlistRounds: [1, 3, 5] as const,
  idleExpiryMs: 12 * 3600_000,
  xpPlayed: 15,
  xpWon: 40,
  coinsWon: 10,
} as const;

export const PARTY_GAMES: Record<PartyGame, { label: string; icon: string; blurb: string }> = {
  TRIVIA: { label: "Music Trivia", icon: "🧠", blurb: "Artists, albums, history and genres. Fastest right answers score most." },
  PLAYLIST: { label: "Battle of the Playlists", icon: "⚔️", blurb: "Two players pick a song for the prompt; everyone else votes." },
  NAME_THAT_SONG: { label: "Name That Song", icon: "🎧", blurb: "Hear a short official preview on the big screen, name the song." },
  FINISH_THE_LYRICS: { label: "Finish the Lyrics", icon: "🎤", blurb: "Pick the next line." },
  DJ_SHOWDOWN: { label: "DJ Showdown", icon: "🎚️", blurb: "Two DJs, one crowd." },
};

/** Prompts for Battle of the Playlists. */
export const PLAYLIST_PROMPTS: readonly string[] = [
  "The song that always starts the party",
  "Best slow jam of all time",
  "A song everyone here knows every word to",
  "Best song to play at a cookout",
  "The ultimate throwback",
  "Best song for a road trip",
  "A song that makes you want to dance right now",
  "Best duet or collab",
  "The perfect last song of the night",
  "Best song from the 2000s",
  "A song your parents would love",
  "Best breakup song",
  "Best workout song",
  "A song that deserves to be bigger",
  "Best opening track on an album",
];

/** "VYBZ-4821" → "4821". */
export function normalizePartyCode(raw: string): string | null {
  const m = /^(?:vybz[-\s]?)?(\d{4,6})$/i.exec(raw.trim());
  return m ? m[1]! : null;
}

export const partyCodeLabel = (code: string) => `VYBZ-${code}`;

export interface PartyPlayerView {
  id: string;
  name: string;
  score: number;
  /** Seen in the last 15 seconds. */
  online: boolean;
  /** Has answered / picked / voted in the current phase. */
  done: boolean;
  isMember: boolean;
}

export interface PartySong {
  title: string;
  artistName: string;
  albumName: string | null;
  releaseYear: number | null;
  artworkUrl: string | null;
}

export interface PartyQuestion {
  prompt: string;
  choices: string[];
  imageUrl: string | null;
  /** Host screen only, for Name That Song. */
  audioUrl: string | null;
  category: string;
}

export interface PartyPlaylistRound {
  prompt: string;
  a: { playerId: string; name: string; song: PartySong | null };
  b: { playerId: string; name: string; song: PartySong | null };
  /** Shown in RESULT. */
  votes: { a: number; b: number } | null;
  winner: "A" | "B" | "DRAW" | null;
}

export interface PartyGameOption {
  game: PartyGame;
  label: string;
  icon: string;
  blurb: string;
  available: boolean;
  reason: string | null;
  rounds: readonly number[];
}

/** How long rounds run: the host picks (birthdays and lounges run relaxed; game nights run fast). */
export const PARTY_PACES = { RELAXED: 1.5, NORMAL: 1, FAST: 0.7 } as const;
export type PartyPace = keyof typeof PARTY_PACES;

interface PartyCommon {
  code: string;
  title: string;
  genre: string | null;
  phase: PartyPhase;
  game: PartyGame | null;
  round: number;
  rounds: number;
  deadline: string | null;
  serverNow: string;
  standings: PartyPlayerView[];
  /** The host paused the clock (deadline is null while paused). */
  paused: boolean;
  /** No new players can join (people already in can rejoin). */
  locked: boolean;
  pace: PartyPace;
}

export interface PartyHostView extends PartyCommon {
  joinUrl: string;
  qrSvg: string;
  players: PartyPlayerView[];
  question: PartyQuestion | null;
  /** REVEAL: the right answer and how many picked each choice. */
  reveal: { answerIndex: number; counts: number[]; explanation: string | null; fastest: string | null } | null;
  playlist: PartyPlaylistRound | null;
  games: PartyGameOption[];
  answered: number;
}

export interface PartyPlayerSelfView extends PartyCommon {
  me: { id: string; name: string; score: number; rank: number };
  question: Omit<PartyQuestion, "audioUrl" | "imageUrl"> & { imageUrl: string | null } | null;
  myAnswer: { choice: number | null; correct: boolean | null; points: number | null } | null;
  reveal: { answerIndex: number } | null;
  playlist: (PartyPlaylistRound & { role: "PICKER" | "VOTER"; myVote: "A" | "B" | null; mySide: "A" | "B" | null }) | null;
}

export interface PartyCreated {
  code: string;
  hostKey: string;
}

export interface PartyJoined {
  code: string;
  playerId: string;
  playerKey: string;
}
