/**
 * Genres and eras for battle rules ("90s R&B").
 *
 * Providers label genres differently (Apple: "R&B/Soul", "Hip-Hop/Rap"), so
 * each canonical genre matches a set of aliases. A track with no genre data is
 * allowed (YouTube has none); a track whose genres are known and don't match
 * is rejected.
 */

export interface GenreDef {
  key: string;
  label: string;
  /** Lower-case fragments matched against provider genre names. */
  aliases: string[];
}

export const GENRES: readonly GenreDef[] = [
  { key: "rnb", label: "R&B", aliases: ["r&b", "rnb", "rhythm and blues", "soul", "neo-soul", "contemporary r&b"] },
  { key: "hiphop", label: "Hip-Hop", aliases: ["hip-hop", "hip hop", "rap", "trap", "drill"] },
  { key: "pop", label: "Pop", aliases: ["pop", "k-pop", "dance pop"] },
  { key: "rock", label: "Rock", aliases: ["rock", "alternative", "punk", "metal", "grunge", "indie rock"] },
  { key: "electronic", label: "Electronic", aliases: ["electronic", "dance", "house", "techno", "edm", "synthwave", "drum & bass", "dubstep"] },
  { key: "country", label: "Country", aliases: ["country", "americana", "bluegrass"] },
  { key: "latin", label: "Latin", aliases: ["latin", "reggaeton", "salsa", "bachata", "urbano"] },
  { key: "reggae", label: "Reggae & Dancehall", aliases: ["reggae", "dancehall", "ska"] },
  { key: "afrobeats", label: "Afrobeats", aliases: ["afrobeats", "afrobeat", "afro-pop", "amapiano", "african"] },
  { key: "jazz", label: "Jazz", aliases: ["jazz", "bebop", "swing"] },
  { key: "funk", label: "Funk & Disco", aliases: ["funk", "disco", "boogie"] },
  { key: "gospel", label: "Gospel", aliases: ["gospel", "christian"] },
  { key: "indie", label: "Indie", aliases: ["indie", "lo-fi", "bedroom pop", "singer/songwriter"] },
];

export const GENRE_KEYS = GENRES.map((g) => g.key) as [string, ...string[]];

export function genreLabel(key: string): string {
  return GENRES.find((g) => g.key === key)?.label ?? key;
}

/** null when the track has no genre data (can't tell). */
export function trackMatchesGenres(trackGenres: readonly string[] | null | undefined, ruleGenres: readonly string[]): boolean | null {
  const names = (trackGenres ?? []).map((g) => g.toLowerCase().trim()).filter((g) => g && g !== "music");
  if (!names.length) return null;
  const defs = GENRES.filter((g) => ruleGenres.includes(g.key));
  return names.some((n) => defs.some((d) => d.aliases.some((a) => n === a || n.includes(a))));
}

export const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020] as const;

export function decadeLabel(start: number): string {
  return start < 2000 ? `${String(start).slice(2)}s` : `${start}s`;
}

/** "90s R&B", "2000s", "Hip-Hop", "1995–2003 R&B / Soul". */
export function themeLabel(c: { eraFrom?: number | undefined; eraTo?: number | undefined; genres?: readonly string[] | undefined } | undefined): string | null {
  if (!c) return null;
  let era = "";
  if (c.eraFrom !== undefined && c.eraTo !== undefined && c.eraFrom % 10 === 0 && c.eraTo === c.eraFrom + 9) era = decadeLabel(c.eraFrom);
  else if (c.eraFrom !== undefined || c.eraTo !== undefined) era = `${c.eraFrom ?? "…"}–${c.eraTo ?? "…"}`;
  const genres = (c.genres ?? []).map(genreLabel).join(" / ");
  const label = [era, genres].filter(Boolean).join(" ");
  return label || null;
}
