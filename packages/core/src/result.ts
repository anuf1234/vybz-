import type { BattleView, ParticipantView } from "./api";
import { themeLabel } from "./genres";

export type ResultOutcome = "WIN" | "LOSS" | "DRAW" | "SPECTATOR";

/** What a finished battle's share card and share message say, from one player's point of view. */
export interface BattleResultSummary {
  outcome: ResultOutcome;
  /** "I beat @maya 3–1 in a 2000s R&B battle." */
  headline: string;
  /** "Think you can beat me?" */
  callToAction: string;
  /** "3–1" for duels; null for group battles. */
  score: string | null;
  /** "2000s R&B" (or the battle's title when it has no theme). */
  theme: string;
  winner: ParticipantView | null;
  /** The person sharing, when they played. */
  me: ParticipantView | null;
  /** In a duel, the other player. */
  opponent: ParticipantView | null;
  /** Who a rematch link challenges: the sharer, or the winner for spectators. */
  challengeHandle: string | null;
  /** 1-based finishing place in a group battle. */
  place: number | null;
}

/** "a 2000s R&B battle", "an Afrobeats battle", "an open battle". */
function aBattle(theme: string): string {
  const t = theme.replace(/\s+battle$/i, "").trim();
  // Said aloud: "an R&B battle", "an 80s battle", "an 1800s…", "a 2000s…".
  const article = /^([aeiou8]|r&b|edm|1[18]\d\d)/i.test(t) ? "an" : "a";
  return `${article} ${t} battle`;
}

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/**
 * The bragging line for a finished battle. `asHandle` is the player sharing
 * it; without one (or for someone who didn't play) it reads as a neutral
 * result and the challenge goes to the winner.
 */
export function battleResultSummary(b: Pick<BattleView, "title" | "theme" | "format" | "participants" | "winnerParticipantId" | "rules">, asHandle?: string | null): BattleResultSummary {
  const theme = b.theme || themeLabel(b.rules.constraints) || b.title;
  const where = aBattle(theme);
  const ranked = [...b.participants].sort((x, y) => y.roundsWon - x.roundsWon || x.side - y.side);
  const winner = b.winnerParticipantId ? (b.participants.find((p) => p.id === b.winnerParticipantId) ?? null) : null;
  const handle = asHandle?.replace(/^@/, "").toLowerCase() ?? null;
  const me = handle ? (b.participants.find((p) => p.user.handle.toLowerCase() === handle) ?? null) : null;
  const duel = b.format === "DUEL" && b.participants.length === 2;
  const opponent = duel && me ? (b.participants.find((p) => p.id !== me.id) ?? null) : null;

  if (duel) {
    const [hi, lo] = ranked as [ParticipantView, ParticipantView];
    const score = `${hi.roundsWon}–${lo.roundsWon}`;
    if (me && opponent) {
      if (!winner) return { outcome: "DRAW", headline: `@${opponent.user.handle} and I went ${score} in ${where}.`, callToAction: "Think you can settle it?", score, theme, winner, me, opponent, challengeHandle: me.user.handle, place: null };
      if (winner.id === me.id) return { outcome: "WIN", headline: `I beat @${opponent.user.handle} ${score} in ${where}.`, callToAction: "Think you can beat me?", score, theme, winner, me, opponent, challengeHandle: me.user.handle, place: 1 };
      return { outcome: "LOSS", headline: `@${opponent.user.handle} edged me ${score} in ${where}.`, callToAction: "Think you'd do better? Take me on.", score, theme, winner, me, opponent, challengeHandle: me.user.handle, place: 2 };
    }
    const loser = winner ? (b.participants.find((p) => p.id !== winner.id) ?? lo) : lo;
    if (!winner) return { outcome: "SPECTATOR", headline: `@${hi.user.handle} and @${lo.user.handle} went ${score} in ${where}.`, callToAction: "Think you can beat them?", score, theme, winner, me: null, opponent: null, challengeHandle: hi.user.handle, place: null };
    return { outcome: "SPECTATOR", headline: `@${winner.user.handle} beat @${loser.user.handle} ${score} in ${where}.`, callToAction: `Think you can beat @${winner.user.handle}?`, score, theme, winner, me: null, opponent: null, challengeHandle: winner.user.handle, place: null };
  }

  const n = b.participants.length;
  const group = `${n === 8 || n === 11 || n === 18 ? "an" : "a"} ${n}-player ${where.replace(/^an? /, "")}`;
  if (me) {
    const place = ranked.findIndex((p) => p.id === me.id) + 1;
    if (winner?.id === me.id) return { outcome: "WIN", headline: `I won ${group}.`, callToAction: "Think you can beat me?", score: null, theme, winner, me, opponent: null, challengeHandle: me.user.handle, place: 1 };
    return { outcome: winner ? "LOSS" : "DRAW", headline: `I finished ${ordinal(place)} of ${n} in ${group}.`, callToAction: "Think you'd do better? Take me on.", score: null, theme, winner, me, opponent: null, challengeHandle: me.user.handle, place };
  }
  return {
    outcome: "SPECTATOR",
    headline: winner ? `@${winner.user.handle} won ${group}.` : `${group[0]!.toUpperCase()}${group.slice(1)} ended level.`,
    callToAction: winner ? `Think you can beat @${winner.user.handle}?` : "Think you can win it?",
    score: null,
    theme,
    winner,
    me: null,
    opponent: null,
    challengeHandle: winner?.user.handle ?? ranked[0]?.user.handle ?? null,
    place: null,
  };
}
