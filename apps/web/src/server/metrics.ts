import type { MetricsResponse } from "@vybz/core";
import { type Executor, sql } from "@vybz/db";
import { isStaff } from "./battles/access";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";

/**
 * Growth numbers for staff: daily/weekly/monthly active people, signup
 * cohorts' Day-1/7/30 retention, what active people do, and plays sent out
 * to streaming services. "Active" means did something: a pick, a vote, a war
 * vote, a trivia game, a post, a 🔥, a This-or-That pick or any reward. Days
 * are UTC. The VYBZ bot and other system accounts are left out.
 */

/** One row per (user, UTC day) with any activity. */
const ACTIVE = sql`
  select user_id, (created_at at time zone 'UTC')::date as day from (
    select user_id, created_at from activity_day where not frozen
    union all select user_id, created_at from ledger_entry
    union all select voter_id, created_at from vote
    union all select bp.user_id, s.created_at from submission s join battle_participant bp on bp.id = s.participant_id
    union all select voter_id, created_at from war_vote
    union all select user_id, coalesce(finished_at, started_at) from trivia_play
    union all select author_id, created_at from post
    union all select user_id, created_at from release_fire
    union all select user_id, created_at from release_duel
  ) a where user_id in (select id from "user" where not is_system)
  group by 1, 2`;

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : null);

async function rows(db: Executor, q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as unknown as { rows?: Row[] } | Row[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

export async function metrics(deps: BattleDeps, viewer: UserRow | null, now = new Date()): Promise<MetricsResponse> {
  if (!viewer) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!isStaff(viewer)) throw new ServiceError(403, "FORBIDDEN");
  const db = deps.db;
  const today = now.toISOString().slice(0, 10);

  const [totals, series, cohorts, engagement, outbound] = await Promise.all([
    rows(
      db,
      sql`with active as (${ACTIVE})
        select
          (select count(*)::int from "user" where not is_system) as users,
          (select count(*)::int from "user" where not is_system and created_at >= ${today}::date - 6) as new7,
          (select count(distinct user_id)::int from active where day = ${today}::date) as dau,
          (select count(distinct user_id)::int from active where day > ${today}::date - 7) as wau,
          (select count(distinct user_id)::int from active where day > ${today}::date - 30) as mau`,
    ),
    rows(
      db,
      sql`with active as (${ACTIVE}), days as (select generate_series(${today}::date - 29, ${today}::date, interval '1 day')::date as day)
        select to_char(d.day, 'YYYY-MM-DD') as day,
          (select count(distinct user_id)::int from active a where a.day = d.day) as dau,
          (select count(*)::int from "user" u where not u.is_system and (u.created_at at time zone 'UTC')::date = d.day) as signups
        from days d order by d.day`,
    ),
    rows(
      db,
      sql`with active as (${ACTIVE}),
        cohort as (select id, (created_at at time zone 'UTC')::date as joined from "user" where not is_system and created_at >= ${today}::date - 63)
        select to_char(date_trunc('week', joined), 'YYYY-MM-DD') as week, count(*)::int as size,
          count(*) filter (where joined + 1 <= ${today}::date)::int as eligible1,
          count(*) filter (where joined + 7 <= ${today}::date)::int as eligible7,
          count(*) filter (where joined + 30 <= ${today}::date)::int as eligible30,
          count(*) filter (where exists (select 1 from active a where a.user_id = c.id and a.day = c.joined + 1))::int as d1,
          count(*) filter (where exists (select 1 from active a where a.user_id = c.id and a.day = c.joined + 7))::int as d7,
          count(*) filter (where exists (select 1 from active a where a.user_id = c.id and a.day = c.joined + 30))::int as d30
        from cohort c group by 1 order by 1 desc`,
    ),
    rows(
      db,
      sql`select
          (select count(distinct bp.battle_id)::int from battle_participant bp join battle b on b.id = bp.battle_id where b.status = 'COMPLETE' and b.ended_at >= now() - interval '7 days') as battles,
          (select count(*)::int from vote where created_at >= now() - interval '7 days') as votes,
          (select count(*)::int from war_vote where created_at >= now() - interval '7 days') as war_votes,
          (select count(*)::int from trivia_play where finished_at >= now() - interval '7 days') as trivia,
          (select count(*)::int from release_fire where created_at >= now() - interval '7 days') as fires,
          (select count(*)::int from release_duel where created_at >= now() - interval '7 days') as verdicts,
          (select count(*)::int from post where created_at >= now() - interval '7 days') as posts,
          (select count(*)::int from release where status = 'LIVE' and created_at >= now() - interval '7 days') as drops,
          (select count(*)::int from release where status = 'PENDING') as pending_mixtapes`,
    ),
    rows(
      db,
      sql`select service,
          count(*) filter (where created_at >= now() - interval '7 days')::int as week,
          count(*) filter (where created_at >= now() - interval '30 days')::int as month,
          count(*)::int as total
        from outbound_click group by service order by total desc`,
    ),
  ]);

  const t = totals[0] ?? {};
  const wau = num(t.wau);
  const e = engagement[0] ?? {};
  return {
    asOf: now.toISOString(),
    users: num(t.users),
    newUsers7d: num(t.new7),
    dau: num(t.dau),
    wau,
    mau: num(t.mau),
    stickiness: pct(num(t.dau), num(t.mau)),
    daily: series.map((r) => ({ day: String(r.day), dau: num(r.dau), signups: num(r.signups) })),
    retention: cohorts.map((r) => ({
      week: String(r.week),
      size: num(r.size),
      d1: pct(num(r.d1), num(r.eligible1)),
      d7: pct(num(r.d7), num(r.eligible7)),
      d30: pct(num(r.d30), num(r.eligible30)),
    })),
    week: {
      battles: num(e.battles),
      votes: num(e.votes),
      warVotes: num(e.war_votes),
      trivia: num(e.trivia),
      fires: num(e.fires),
      verdicts: num(e.verdicts),
      posts: num(e.posts),
      drops: num(e.drops),
      pendingMixtapes: num(e.pending_mixtapes),
      perActiveUser: wau ? Math.round(((num(e.battles) + num(e.votes) + num(e.war_votes) + num(e.trivia) + num(e.fires) + num(e.verdicts)) / wau) * 10) / 10 : 0,
    },
    outbound: outbound.map((r) => ({ service: String(r.service), week: num(r.week), month: num(r.month), total: num(r.total) })),
  };
}
