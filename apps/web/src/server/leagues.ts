import { DIVISIONS, LEAGUE, LEAGUES, type LeagueOutcome, type LeagueView, divisionOf, isoWeek, leagueOutcome, nextTier, weekBounds, weekStart } from "@vybz/core";
import { and, asc, desc, eq, gte, inArray, isNull, lt, newId, schema, sql } from "@vybz/db";
import type { BattleDeps, UserRow } from "./battles/service";
import { createNotifications, type NewNotification } from "./notifications";

/**
 * Weekly leagues (see @vybz/core leagues.ts). The scheduler puts anyone who
 * earned XP this week into a group at their tier, and closes last week's
 * groups: final ranks, promotions and demotions, and a notification each.
 * Points are the XP people earn that week, read from the ledger, so nothing
 * new has to be counted.
 */

/** XP each person earned in [start, end). */
async function weekXp(deps: BattleDeps, userIds: string[], start: Date, end: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!userIds.length) return out;
  const rows = await deps.db
    .select({ id: schema.ledgerEntry.userId, xp: sql<number>`coalesce(sum(${schema.ledgerEntry.xp}), 0)::int` })
    .from(schema.ledgerEntry)
    .where(and(inArray(schema.ledgerEntry.userId, userIds), gte(schema.ledgerEntry.createdAt, start), lt(schema.ledgerEntry.createdAt, end)))
    .groupBy(schema.ledgerEntry.userId);
  for (const r of rows) out.set(r.id, r.xp);
  return out;
}

/** Someone's tier this week: where last week's result left them (Opening Act if they've never played). */
async function tierFor(deps: BattleDeps, userId: string, week: string): Promise<number> {
  const [last] = await deps.db
    .select()
    .from(schema.leagueMember)
    .where(and(eq(schema.leagueMember.userId, userId), lt(schema.leagueMember.week, week)))
    .orderBy(desc(schema.leagueMember.week))
    .limit(1);
  return last ? nextTier(last.tier, (last.outcome as LeagueOutcome | null) ?? null) : 0;
}

/** Puts everyone who earned XP this week (and isn't in a group yet) into one. Returns how many joined. */
export async function assignLeagues(deps: BattleDeps, now = deps.now?.() ?? new Date()): Promise<number> {
  const week = isoWeek(now);
  const { start, end } = weekBounds(now);
  const fresh = await deps.db
    .selectDistinct({ id: schema.ledgerEntry.userId })
    .from(schema.ledgerEntry)
    .innerJoin(schema.user, eq(schema.user.id, schema.ledgerEntry.userId))
    .where(
      and(
        gte(schema.ledgerEntry.createdAt, start),
        lt(schema.ledgerEntry.createdAt, end),
        sql`${schema.ledgerEntry.xp} > 0`,
        eq(schema.user.status, "ACTIVE"),
        eq(schema.user.isSystem, false),
        eq(schema.user.isAnonymous, false),
        sql`not exists (select 1 from league_member m where m.user_id = ${schema.ledgerEntry.userId} and m.week = ${week})`,
      ),
    )
    .limit(500);
  let n = 0;
  for (const { id } of fresh) {
    const tier = await tierFor(deps, id, week);
    // Fill the newest group at this tier; open another when it's full.
    const [open] = await deps.db
      .select({ groupId: schema.leagueMember.groupId, n: sql<number>`count(*)::int` })
      .from(schema.leagueMember)
      .where(and(eq(schema.leagueMember.week, week), eq(schema.leagueMember.tier, tier)))
      .groupBy(schema.leagueMember.groupId)
      .orderBy(desc(sql`max(${schema.leagueMember.createdAt})`))
      .limit(1);
    const groupId = open && open.n < LEAGUE.groupSize ? open.groupId : newId();
    const [row] = await deps.db.insert(schema.leagueMember).values({ userId: id, week, tier, groupId }).onConflictDoNothing().returning();
    if (row) n++;
  }
  return n;
}

/** Closes every finished week's groups: final ranks, who moved up or down, and tells them. */
export async function closeLeagueWeeks(deps: BattleDeps, now = deps.now?.() ?? new Date()): Promise<number> {
  const week = isoWeek(now);
  const open = await deps.db
    .selectDistinct({ week: schema.leagueMember.week, groupId: schema.leagueMember.groupId })
    .from(schema.leagueMember)
    .where(and(lt(schema.leagueMember.week, week), isNull(schema.leagueMember.finalRank)))
    .limit(200);
  let closed = 0;
  for (const g of open) {
    const members = await deps.db.select().from(schema.leagueMember).where(and(eq(schema.leagueMember.week, g.week), eq(schema.leagueMember.groupId, g.groupId))).orderBy(asc(schema.leagueMember.createdAt));
    const start = weekStart(g.week);
    const xp = await weekXp(deps, members.map((m) => m.userId), start, new Date(start.getTime() + 7 * 86_400_000));
    const ranked = [...members].sort((a, b) => (xp.get(b.userId) ?? 0) - (xp.get(a.userId) ?? 0) || a.createdAt.getTime() - b.createdAt.getTime());
    const notes: NewNotification[] = [];
    for (const [i, m] of ranked.entries()) {
      const pts = xp.get(m.userId) ?? 0;
      const outcome = leagueOutcome(i + 1, ranked.length, m.tier, pts);
      await deps.db.update(schema.leagueMember).set({ finalRank: i + 1, finalXp: pts, outcome }).where(and(eq(schema.leagueMember.userId, m.userId), eq(schema.leagueMember.week, m.week)));
      const to = LEAGUES[nextTier(m.tier, outcome)]!;
      notes.push({
        userId: m.userId,
        type: "LEAGUE",
        title: outcome === "PROMOTED" ? `${to.icon} Up to the ${to.label} league!` : outcome === "DEMOTED" ? `Down to the ${to.label} league` : `${to.icon} You held on in ${to.label}`,
        body: `You finished #${i + 1} of ${ranked.length} last week with ${pts} XP.${outcome === "DEMOTED" ? " Win your way back this week." : ""}`,
        battleId: null,
        link: "/leagues",
      });
    }
    await createNotifications(deps.db, deps.push, notes).catch((err) => console.error("league notes failed", err));
    closed++;
  }
  return closed;
}

export async function leagueView(deps: BattleDeps, viewer: UserRow, now = deps.now?.() ?? new Date()): Promise<LeagueView> {
  const week = isoWeek(now);
  const { start, end } = weekBounds(now);
  const [mine] = await deps.db.select().from(schema.leagueMember).where(and(eq(schema.leagueMember.userId, viewer.id), eq(schema.leagueMember.week, week)));
  const tier = mine?.tier ?? (await tierFor(deps, viewer.id, week));
  const [last] = await deps.db
    .select()
    .from(schema.leagueMember)
    .where(and(eq(schema.leagueMember.userId, viewer.id), lt(schema.leagueMember.week, week)))
    .orderBy(desc(schema.leagueMember.week))
    .limit(1);
  const badges = await deps.db.select().from(schema.seasonBadge).where(eq(schema.seasonBadge.userId, viewer.id)).orderBy(desc(schema.seasonBadge.season));

  let standings: LeagueView["standings"] = null;
  let myRank: number | null = null;
  if (mine) {
    const members = await deps.db
      .select({ m: schema.leagueMember, handle: schema.user.handle, name: schema.user.name, image: schema.user.image })
      .from(schema.leagueMember)
      .innerJoin(schema.user, eq(schema.user.id, schema.leagueMember.userId))
      .where(and(eq(schema.leagueMember.week, week), eq(schema.leagueMember.groupId, mine.groupId)));
    const xp = await weekXp(deps, members.map((x) => x.m.userId), start, end);
    const size = members.length;
    standings = members
      .sort((a, b) => (xp.get(b.m.userId) ?? 0) - (xp.get(a.m.userId) ?? 0) || a.m.createdAt.getTime() - b.m.createdAt.getTime())
      .map((x, i) => {
        const outcome = leagueOutcome(i + 1, size, tier, xp.get(x.m.userId) ?? 0);
        return {
          rank: i + 1,
          user: { id: x.m.userId, handle: x.handle, displayName: x.name, image: x.image },
          xp: xp.get(x.m.userId) ?? 0,
          zone: outcome === "PROMOTED" ? ("UP" as const) : outcome === "DEMOTED" ? ("DOWN" as const) : null,
          me: x.m.userId === viewer.id,
        };
      });
    myRank = standings.find((s) => s.me)?.rank ?? null;
  }
  const l = LEAGUES[tier]!;
  return {
    week,
    endsAt: end.toISOString(),
    tier,
    league: { key: l.key, label: l.label, icon: l.icon },
    standings,
    myRank,
    last: last?.outcome && last.finalRank ? { week: last.week, tier: last.tier, outcome: last.outcome as LeagueOutcome, rank: last.finalRank } : null,
    badges: badges.map((b) => {
      const d = DIVISIONS.find((x) => x.key === b.division) ?? divisionOf(b.peak);
      return { season: b.season, division: d.key, label: d.label, icon: d.icon };
    }),
  };
}
