import { type BattleAggregate, DIVISIONS, RANKED, type RankView, type RankedResponse, divisionOf, eloDelta, isDuel, seasonOf, softReset } from "@vybz/core";
import { type Executor, and, desc, eq, gt, schema, sql } from "@vybz/db";
import type { BattleDeps, UserRow } from "./battles/service";
import { createNotifications, type NewNotification, type PushSender } from "./notifications";

/**
 * Ranked: Elo from ranked quick battles between two people (never the bot).
 * Ratings live per season (quarter); a new season starts each person
 * halfway back to 1000. Each battle is applied once (rated_battle).
 */

type RatingRow = typeof schema.userRating.$inferSelect;

export function rankView(r: Pick<RatingRow, "season" | "rating" | "peak" | "games" | "wins" | "losses" | "draws">): RankView {
  const d = divisionOf(r.rating);
  const next = DIVISIONS.find((x) => x.min > r.rating);
  return {
    season: r.season,
    rating: r.rating,
    peak: r.peak,
    games: r.games,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    division: d.key,
    divisionLabel: d.label,
    icon: d.icon,
    placement: r.games < RANKED.placementGames,
    toNext: next ? next.min - r.rating : null,
  };
}

/** This season's row, created or soft-reset as needed. */
export async function ratingFor(db: Executor, userId: string, now = new Date()): Promise<RatingRow> {
  const season = seasonOf(now);
  const [row] = await db.select().from(schema.userRating).where(eq(schema.userRating.userId, userId));
  if (row?.season === season) return row;
  const rating = row ? softReset(row.rating) : RANKED.start;
  const values = { userId, season, rating, peak: rating, games: 0, wins: 0, losses: 0, draws: 0 };
  const [out] = await db.insert(schema.userRating).values(values).onConflictDoUpdate({ target: schema.userRating.userId, set: values }).returning();
  return out!;
}

/** Applies a finished ranked duel to both players' ratings, once. Tells anyone who changed division. */
export async function applyRanked(db: Executor, push: PushSender | null | undefined, agg: BattleAggregate, now = new Date()): Promise<boolean> {
  if (!isDuel(agg.rules) || agg.status !== "COMPLETE" || agg.participants.length !== 2) return false;
  const [b] = await db.select({ ranked: schema.battle.ranked }).from(schema.battle).where(eq(schema.battle.id, agg.id));
  if (!b?.ranked) return false;
  const ids = agg.participants.map((p) => p.userId);
  const sys = await db.select({ id: schema.user.id }).from(schema.user).where(and(sql`${schema.user.id} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`, eq(schema.user.isSystem, true)));
  if (sys.length) return false;
  const [claim] = await db.insert(schema.ratedBattle).values({ battleId: agg.id, changes: {} }).onConflictDoNothing().returning();
  if (!claim) return false;

  const [pa, pb] = agg.participants as [(typeof agg.participants)[number], (typeof agg.participants)[number]];
  const [ra, rb] = [await ratingFor(db, pa.userId, now), await ratingFor(db, pb.userId, now)];
  const scoreA = agg.winnerParticipantId === pa.id ? 1 : agg.winnerParticipantId === pb.id ? 0 : 0.5;
  const kA = ra.games < RANKED.placementGames ? RANKED.placementK : RANKED.k;
  const kB = rb.games < RANKED.placementGames ? RANKED.placementK : RANKED.k;
  const dA = eloDelta(ra.rating, rb.rating, scoreA, kA);
  const dB = eloDelta(rb.rating, ra.rating, 1 - scoreA, kB);
  const changes: Record<string, { before: number; after: number }> = {};
  const notes: NewNotification[] = [];
  for (const [r, d, score] of [
    [ra, dA, scoreA],
    [rb, dB, 1 - scoreA],
  ] as const) {
    const after = Math.max(100, r.rating + d);
    changes[r.userId] = { before: r.rating, after };
    await db
      .update(schema.userRating)
      .set({
        rating: after,
        peak: Math.max(r.peak, after),
        games: r.games + 1,
        wins: r.wins + (score === 1 ? 1 : 0),
        losses: r.losses + (score === 0 ? 1 : 0),
        draws: r.draws + (score === 0.5 ? 1 : 0),
      })
      .where(eq(schema.userRating.userId, r.userId));
    const was = divisionOf(r.rating);
    const now_ = divisionOf(after);
    if (now_.key !== was.key && r.games + 1 >= RANKED.placementGames) {
      const up = now_.min > was.min;
      notes.push({ userId: r.userId, type: "RANKED", title: up ? `${now_.icon} Promoted to ${now_.label}!` : `Down to ${now_.label}`, body: up ? `You're ${after} rated. Keep climbing.` : `You're ${after} rated. Win your way back up.`, battleId: agg.id, link: "/ranked" });
    } else if (r.games + 1 === RANKED.placementGames) {
      notes.push({ userId: r.userId, type: "RANKED", title: `${now_.icon} Placed in ${now_.label}`, body: `Placement done: ${after} rated.`, battleId: agg.id, link: "/ranked" });
    }
  }
  await db.update(schema.ratedBattle).set({ changes }).where(eq(schema.ratedBattle.battleId, agg.id));
  await createNotifications(db, push, notes);
  return true;
}

export async function rankedBoard(deps: BattleDeps, viewer: UserRow | null, now = new Date()): Promise<RankedResponse> {
  const season = seasonOf(now);
  const r = schema.userRating;
  const rows = await deps.db
    .select({ rating: r.rating, games: r.games, wins: r.wins, handle: schema.user.handle, name: schema.user.name, image: schema.user.image })
    .from(r)
    .innerJoin(schema.user, eq(schema.user.id, r.userId))
    .where(and(eq(r.season, season), gt(r.games, 0), eq(schema.user.status, "ACTIVE")))
    .orderBy(desc(r.rating), desc(r.games))
    .limit(50);
  const me = viewer ? await deps.db.select().from(r).where(eq(r.userId, viewer.id)).then((x) => x[0]) : undefined;
  return {
    season,
    me: viewer ? rankView(me && me.season === season ? me : { season, rating: me ? softReset(me.rating) : RANKED.start, peak: me ? softReset(me.rating) : RANKED.start, games: 0, wins: 0, losses: 0, draws: 0 }) : null,
    meHandle: viewer?.handle ?? null,
    top: rows.map((x, i) => {
      const d = divisionOf(x.rating);
      return { rank: i + 1, user: { handle: x.handle ?? "unknown", displayName: x.name, image: x.image }, rating: x.rating, division: d.key, icon: d.icon, games: x.games, wins: x.wins };
    }),
    divisions: DIVISIONS.map((d) => ({ key: d.key, label: d.label, icon: d.icon, min: d.min })),
  };
}
