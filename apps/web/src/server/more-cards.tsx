import { GENRE_KEYS, genreLabel, normalizePartyCode } from "@vybz/core";
import { and, desc, eq, gt, isNull, or, schema, sql } from "@vybz/db";
import type { ImageResponse } from "next/og";
import type { BattleDeps, UserRow } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { leaderboard } from "@/server/leaderboards";
import { leagueView } from "@/server/leagues";
import { MUTED, SOFT, type Font, loadFonts } from "@/server/share-card";
import { type CardFormat, Cover, artData, frame, plain } from "@/server/share-cards";
import { getWar } from "@/server/wars";

/**
 * More things worth bragging about: your weekly league, your genre ranks,
 * your trivia score, and which side you took in an album war. Same frame and
 * sizes as the other cards; nothing private (league groups and genre ranks
 * are public standings; a trivia card needs its unguessable play id).
 */

const big = (story: boolean, s: number, w: number) => (story ? s : w);

async function userByHandle(handle: string): Promise<UserRow | null> {
  const [u] = await getBattleDeps().db.select().from(schema.user).where(and(eq(schema.user.handle, handle.toLowerCase()), eq(schema.user.status, "ACTIVE")));
  return u && !u.isAnonymous ? u : null;
}

// ── Weekly league ──────────────────────────────────────────────────────────

export async function leagueCard(handle: string, format: CardFormat): Promise<ImageResponse> {
  const f = await loadFonts();
  const u = await userByHandle(handle);
  if (!u) return plain(format, f);
  const v = await leagueView(getBattleDeps(), u);
  const story = format === "story";
  const me = v.standings?.find((s) => s.me);
  const headline = me ? `#${me.rank} in my group this week` : v.last ? `Finished #${v.last.rank} last week` : "Climbing the leagues";
  return frame(
    format,
    f,
    <div style={{ display: "flex", flexDirection: "column", alignItems: story ? "center" : "flex-start", gap: big(story, 24, 12) }}>
      <div style={{ display: "flex", fontSize: big(story, 40, 24), color: SOFT, fontWeight: 800, letterSpacing: 4 }}>WEEKLY LEAGUE</div>
      <div style={{ display: "flex", fontSize: big(story, 130, 80), fontWeight: 800, textAlign: "center" }}>{v.league.label.toUpperCase()}</div>
      <div style={{ display: "flex", fontSize: big(story, 56, 34), fontWeight: 800 }}>{headline}</div>
      {me ? <div style={{ display: "flex", fontSize: big(story, 44, 28), color: MUTED }}>{`@${u.handle} · ${me.xp} XP${me.zone === "UP" ? " · in the promotion zone" : ""}`}</div> : <div style={{ display: "flex", fontSize: big(story, 44, 28), color: MUTED }}>{`@${u.handle}`}</div>}
      {v.badges.length ? <div style={{ display: "flex", fontSize: big(story, 36, 22), color: MUTED }}>{`Ranked seasons: ${v.badges.map((b) => `${b.label} ${b.season}`).join(" · ")}`}</div> : null}
    </div>,
    "Join my league. Battle on VYBZ.",
  );
}

// ── Genre ranks ────────────────────────────────────────────────────────────

/** Where someone ranks by wins in each genre this month, best first (only genres they've won in). */
export async function genreRanks(deps: BattleDeps, user: UserRow): Promise<{ genre: string; label: string; rank: number; wins: number }[]> {
  const out: { genre: string; label: string; rank: number; wins: number }[] = [];
  for (const genre of GENRE_KEYS) {
    const board = await leaderboard(deps, user, { scope: "genre", genre, period: "month", metric: "wins" });
    if (board.me && board.me.wins > 0) out.push({ genre, label: genreLabel(genre), rank: board.me.rank, wins: board.me.wins });
  }
  return out.sort((a, b) => a.rank - b.rank || b.wins - a.wins);
}

export async function genreCard(handle: string, format: CardFormat): Promise<ImageResponse> {
  const f = await loadFonts();
  const u = await userByHandle(handle);
  if (!u) return plain(format, f);
  const ranks = (await genreRanks(getBattleDeps(), u)).slice(0, story(format) ? 5 : 3);
  if (!ranks.length) return plain(format, f);
  const s = story(format);
  return frame(
    format,
    f,
    <div style={{ display: "flex", flexDirection: "column", alignItems: s ? "center" : "flex-start", gap: big(s, 26, 10) }}>
      <div style={{ display: "flex", fontSize: big(s, 40, 24), color: SOFT, fontWeight: 800, letterSpacing: 4 }}>MY GENRE RANKS · THIS MONTH</div>
      <div style={{ display: "flex", fontSize: big(s, 48, 30), color: MUTED }}>{`@${u.handle}`}</div>
      {ranks.map((r) => (
        <div key={r.genre} style={{ display: "flex", alignItems: "baseline", gap: big(s, 30, 18) }}>
          <div style={{ display: "flex", fontSize: big(s, 110, 64), fontWeight: 800, color: r.rank <= 3 ? SOFT : "white" }}>{`#${r.rank}`}</div>
          <div style={{ display: "flex", fontSize: big(s, 64, 38), fontWeight: 800 }}>{r.label}</div>
          <div style={{ display: "flex", fontSize: big(s, 36, 22), color: MUTED }}>{`${r.wins} win${r.wins === 1 ? "" : "s"}`}</div>
        </div>
      ))}
    </div>,
    "Know these genres better? Battle me.",
  );
}

function story(format: CardFormat): boolean {
  return format === "story";
}

// ── Trivia ─────────────────────────────────────────────────────────────────

export async function triviaCard(playId: string, format: CardFormat): Promise<ImageResponse> {
  const f = await loadFonts();
  const { db } = getBattleDeps();
  const [p] = await db
    .select({ play: schema.triviaPlay, set: schema.triviaSet, handle: schema.user.handle })
    .from(schema.triviaPlay)
    .innerJoin(schema.triviaSet, eq(schema.triviaSet.id, schema.triviaPlay.setId))
    .innerJoin(schema.user, eq(schema.user.id, schema.triviaPlay.userId))
    .where(eq(schema.triviaPlay.id, playId));
  if (!p || !p.play.finishedAt) return plain(format, f);
  const [{ better, players }] = (await db
    .select({ better: sql<number>`count(*) filter (where ${schema.triviaPlay.score} < ${p.play.score})::int`, players: sql<number>`count(*)::int` })
    .from(schema.triviaPlay)
    .where(and(eq(schema.triviaPlay.setId, p.set.id), gt(schema.triviaPlay.total, 0), sql`${schema.triviaPlay.finishedAt} is not null`))) as [{ better: number; players: number }];
  const s = story(format);
  const set = p.set as { mode?: string; day?: string | null; genre?: string | null };
  const label = set.mode === "DAILY" && set.day ? `Daily trivia · ${set.day}` : set.genre ? `${genreLabel(set.genre)} trivia` : "Music trivia";
  const pctBetter = players > 1 ? Math.round((better * 100) / (players - 1)) : null;
  return frame(
    format,
    f,
    <div style={{ display: "flex", flexDirection: "column", alignItems: s ? "center" : "flex-start", gap: big(s, 22, 10) }}>
      <div style={{ display: "flex", fontSize: big(s, 40, 24), color: SOFT, fontWeight: 800, letterSpacing: 4 }}>{label.toUpperCase()}</div>
      <div style={{ display: "flex", fontSize: big(s, 200, 120), fontWeight: 800 }}>{`${p.play.correct}/${p.play.total}`}</div>
      <div style={{ display: "flex", fontSize: big(s, 56, 34), fontWeight: 800 }}>{`${p.play.score} points`}</div>
      <div style={{ display: "flex", fontSize: big(s, 44, 28), color: MUTED }}>{pctBetter ? `@${p.handle} · better than ${pctBetter}% of players` : `@${p.handle}`}</div>
    </div>,
    "Beat my score on VYBZ.",
  );
}

// ── Album war: my pick ─────────────────────────────────────────────────────

/** "I picked X over Y": the side comes from the sharer (the card makes no claim about anyone else). */
export async function warPickCard(id: string, format: CardFormat, pick: "A" | "B"): Promise<ImageResponse> {
  const f: Font[] = await loadFonts();
  const w = await getWar(getBattleDeps(), null, id).catch(() => null);
  if (!w) return plain(format, f);
  const s = story(format);
  const mine = pick === "A" ? w.a : w.b;
  const other = pick === "A" ? w.b : w.a;
  const [artMine, artOther] = await Promise.all([artData(mine.artworkUrl), artData(other.artworkUrl)]);
  return frame(
    format,
    f,
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: big(s, 40, 18) }}>
      <div style={{ display: "flex", fontSize: big(s, 40, 26), color: SOFT, fontWeight: 800, letterSpacing: 4 }}>{w.kind === "ALBUM" ? "ALBUM WAR · MY PICK" : "SINGLE WAR · MY PICK"}</div>
      <div style={{ display: "flex", alignItems: "center", gap: big(s, 40, 36) }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Cover url={artMine} size={big(s, 420, 250)} />
          <div style={{ display: "flex", fontSize: big(s, 26, 18), fontWeight: 800, color: "#0A0614", background: SOFT, borderRadius: 999, padding: "6px 18px", letterSpacing: 3 }}>MY PICK</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, opacity: 0.5 }}>
          <Cover url={artOther} size={big(s, 260, 160)} />
        </div>
      </div>
      <div style={{ display: "flex", fontSize: big(s, 58, 34), fontWeight: 800, textAlign: "center", justifyContent: "center", maxWidth: big(s, 940, 1100) }}>{`${mine.title.slice(0, 40)} over ${other.title.slice(0, 40)}`}</div>
      <div style={{ display: "flex", fontSize: big(s, 36, 24), color: MUTED }}>{`${mine.artistName.slice(0, 30)} vs ${other.artistName.slice(0, 30)}`}</div>
    </div>,
    "Wrong? Vote the other way on VYBZ.",
  );
}

// ── Party leaderboard ──────────────────────────────────────────────────────

/** A party's podium, for the host to post: title, top five and how many played. Players appear by their party nicknames. */
export async function partyCard(code: string, format: CardFormat): Promise<ImageResponse> {
  const f = await loadFonts();
  const c = normalizePartyCode(code);
  if (!c) return plain(format, f);
  const { db } = getBattleDeps();
  const [p] = await db
    .select()
    .from(schema.party)
    .where(and(eq(schema.party.code, c), or(isNull(schema.party.endedAt), gt(schema.party.endedAt, new Date(Date.now() - 6 * 3600_000)))))
    .orderBy(desc(schema.party.createdAt))
    .limit(1);
  if (!p) return plain(format, f);
  const players = await db
    .select({ name: schema.partyPlayer.name, score: schema.partyPlayer.score })
    .from(schema.partyPlayer)
    .where(and(eq(schema.partyPlayer.partyId, p.id), eq(schema.partyPlayer.removed, false)))
    .orderBy(desc(schema.partyPlayer.score));
  if (!players.length) return plain(format, f);
  const s = story(format);
  const medals = ["1ST", "2ND", "3RD", "4TH", "5TH"];
  return frame(
    format,
    f,
    <div style={{ display: "flex", flexDirection: "column", alignItems: s ? "center" : "flex-start", gap: big(s, 22, 8) }}>
      <div style={{ display: "flex", fontSize: big(s, 40, 22), color: SOFT, fontWeight: 800, letterSpacing: 4 }}>{`PARTY MODE · ${players.length} PLAYERS`}</div>
      <div style={{ display: "flex", fontSize: big(s, 80, 48), fontWeight: 800, textAlign: "center", marginBottom: big(s, 30, 6) }}>{p.title.slice(0, 40)}</div>
      {players.slice(0, s ? 5 : 3).map((pl, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: big(s, 28, 16), width: big(s, 880, 1000), padding: s ? "22px 36px" : "8px 20px", borderRadius: 30, background: i === 0 ? "rgba(196,181,253,0.18)" : "rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", width: big(s, 110, 70), fontSize: big(s, 34, 22), fontWeight: 800, color: i === 0 ? SOFT : MUTED }}>{medals[i]}</div>
          <div style={{ display: "flex", flex: 1, fontSize: big(s, 52, 32), fontWeight: 800 }}>{pl.name.slice(0, 20)}</div>
          <div style={{ display: "flex", fontSize: big(s, 52, 32), fontWeight: 800 }}>{`${pl.score}`}</div>
        </div>
      ))}
    </div>,
    "Host your own party on VYBZ.",
  );
}
