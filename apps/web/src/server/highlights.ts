import type { BattleListItem, FeedHighlight } from "@vybz/core";
import { and, desc, eq, gte, inArray, isNotNull, schema, sql } from "@vybz/db";
import { BOT_HANDLE } from "./bot";
import { type BattleDeps, type UserRow, toListItems } from "./battles/service";

/**
 * What's happening on VYBZ, for a Feed that's useful before you follow
 * anyone: public battle results, battles live right now, the album votes
 * people are piling into, and what VYBZ is featuring. Each item says whether
 * it came from players (COMMUNITY) or from VYBZ (EDITORIAL). Public content
 * only; no vote or play counts.
 */

const DAY = 24 * 60 * 60 * 1000;

function handles(b: BattleListItem): string {
  return [...b.participants].sort((x, y) => x.side - y.side).map((p) => `@${p.user.handle}`).join(" vs ");
}

function resultLine(b: BattleListItem): string {
  const winner = b.participants.find((p) => p.id === b.winnerParticipantId);
  if (b.format === "DUEL" && b.participants.length === 2) {
    const [hi, lo] = [...b.participants].sort((x, y) => y.roundsWon - x.roundsWon);
    if (!winner) return `@${hi!.user.handle} and @${lo!.user.handle} ended level ${hi!.roundsWon}–${lo!.roundsWon}`;
    const loser = b.participants.find((p) => p.id !== winner.id)!;
    return `@${winner.user.handle} beat @${loser.user.handle} ${winner.roundsWon}–${loser.roundsWon}`;
  }
  return winner ? `@${winner.user.handle} won against ${b.participants.length - 1} others` : `${b.participants.length} players, ended level`;
}

/** Up to two covers per battle: the winner's picks first. */
async function battleArt(deps: BattleDeps, items: BattleListItem[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!items.length) return out;
  const rows = await deps.db
    .select({ battleId: schema.submission.battleId, participantId: schema.submission.participantId, art: schema.track.artworkUrl })
    .from(schema.submission)
    .innerJoin(schema.track, eq(schema.track.id, schema.submission.trackId))
    .where(and(inArray(schema.submission.battleId, items.map((i) => i.id)), isNotNull(schema.track.artworkUrl)));
  for (const item of items) {
    const mine = rows.filter((r) => r.battleId === item.id);
    const ordered = [...mine.filter((r) => r.participantId === item.winnerParticipantId), ...mine.filter((r) => r.participantId !== item.winnerParticipantId)];
    out.set(item.id, [...new Set(ordered.map((r) => r.art!))].slice(0, 2));
  }
  return out;
}

/** Take one from each list in turn, so the feed mixes kinds. */
function interleave<T>(lists: T[][], max: number): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < max && lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i] && out.length < max) out.push(l[i]!);
  return out;
}

export async function feedHighlights(deps: BattleDeps, viewer: UserRow | null, max = 10): Promise<FeedHighlight[]> {
  const b = schema.battle;
  const now = Date.now();
  const votes = sql<number>`(select count(*) from ${schema.vote} v where v.battle_id = ${b.id})`;
  const recentVotes = sql<number>`(select count(*) from ${schema.vote} v where v.battle_id = ${b.id} and v.created_at > ${new Date(now - DAY)})`;
  const isPublic = eq(b.visibility, "PUBLIC");

  const [resultRows, liveRows, featuredRows, warRows, tournamentRows] = await Promise.all([
    deps.db.select().from(b).where(and(isPublic, eq(b.status, "COMPLETE"), gte(b.endedAt, new Date(now - 14 * DAY)), eq(b.featured, false))).orderBy(desc(votes), desc(b.endedAt)).limit(4),
    deps.db.select().from(b).where(and(isPublic, eq(b.status, "IN_PROGRESS"), eq(b.featured, false))).orderBy(desc(recentVotes), desc(b.updatedAt)).limit(3),
    deps.db
      .select()
      .from(b)
      .where(and(isPublic, inArray(b.status, ["OPEN_CHALLENGE", "IN_PROGRESS"]), sql`(${b.featured} or ${b.dailyDate} is not null)`))
      .orderBy(desc(b.featured), desc(b.updatedAt))
      .limit(3),
    deps.db
      .select({ war: schema.war, creator: schema.user.handle })
      .from(schema.war)
      .innerJoin(schema.user, eq(schema.user.id, schema.war.creatorId))
      .where(eq(schema.war.status, "OPEN"))
      .orderBy(desc(sql`(select count(distinct wv.voter_id) from ${schema.warVote} wv where wv.war_id = ${schema.war.id} and wv.created_at > ${new Date(now - 3 * DAY)})`), desc(schema.war.createdAt))
      .limit(3),
    deps.db.select().from(schema.tournament).where(eq(schema.tournament.status, "LIVE")).orderBy(desc(schema.tournament.createdAt)).limit(1),
  ]);

  const [results, live, featured] = await Promise.all([toListItems(deps, viewer, resultRows), toListItems(deps, viewer, liveRows), toListItems(deps, viewer, featuredRows)]);
  const art = await battleArt(deps, [...results, ...live, ...featured]);
  const at = (iso: string | Date | null | undefined) => (iso ? new Date(iso).toISOString() : new Date(now).toISOString());

  const resultItems: FeedHighlight[] = results.map((r, i) => ({
    id: `result:${r.id}`,
    kind: "RESULT",
    source: "COMMUNITY",
    label: "Battle result",
    title: resultLine(r),
    subtitle: r.theme ?? r.title,
    artwork: art.get(r.id) ?? [],
    href: `/battle/${r.id}`,
    at: at(resultRows[i]?.endedAt),
  }));
  const liveItems: FeedHighlight[] = live.map((r) => ({
    id: `live:${r.id}`,
    kind: "LIVE",
    source: "COMMUNITY",
    label: r.currentRoundStatus === "VOTING_OPEN" ? "Live · vote now" : "Live now",
    title: handles(r),
    subtitle: `${r.theme ?? r.title} · round ${(r.currentRoundIndex ?? 0) + 1} of ${r.roundCount}`,
    artwork: art.get(r.id) ?? [],
    href: `/battle/${r.id}`,
    at: r.createdAt,
  }));
  const featuredItems: FeedHighlight[] = featured.map((r) => ({
    id: `featured:${r.id}`,
    kind: "FEATURED",
    source: "EDITORIAL",
    label: r.dailyDate ? "Daily battle" : "Featured challenge",
    title: r.title,
    subtitle: r.status === "OPEN_CHALLENGE" ? (r.format === "DUEL" ? "Open: anyone can take it" : `Join · ${r.participants.length}/${r.maxEntrants} in`) : handles(r) || "Live now",
    artwork: art.get(r.id) ?? [],
    href: `/battle/${r.id}`,
    at: r.createdAt,
  }));
  const warItems: FeedHighlight[] = warRows.map(({ war, creator }) => {
    const a = war.a as { title: string; artistName: string; artworkUrl: string | null };
    const bSide = war.b as { title: string; artistName: string; artworkUrl: string | null };
    const editorial = creator === BOT_HANDLE;
    return {
      id: `war:${war.id}`,
      kind: "WAR",
      source: editorial ? "EDITORIAL" : "COMMUNITY",
      label: war.kind === "ALBUM" ? "Trending album vote" : "Trending single vote",
      title: `${a.title} vs ${bSide.title}`,
      subtitle: `${a.artistName} vs ${bSide.artistName}${editorial ? "" : ` · started by @${creator}`}`,
      artwork: [a.artworkUrl, bSide.artworkUrl].filter((x): x is string => !!x),
      href: `/wars/${war.id}`,
      at: at(war.createdAt),
    };
  });
  const tournamentItems: FeedHighlight[] = tournamentRows.map((t) => {
    const entries = (t.entries as { artworkUrl?: string | null }[]) ?? [];
    return {
      id: `tournament:${t.id}`,
      kind: "TOURNAMENT",
      source: "EDITORIAL",
      label: "Tournament",
      title: t.title,
      subtitle: `Round ${t.round + 1} · vote every matchup`,
      artwork: entries.map((e) => e.artworkUrl).filter((x): x is string => !!x).slice(0, 2),
      href: `/tournaments/${t.id}`,
      at: at(t.createdAt),
    };
  });

  return interleave([featuredItems, resultItems, warItems, liveItems, tournamentItems], max);
}
