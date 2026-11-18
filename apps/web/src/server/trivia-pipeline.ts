import { GENRE_KEYS, TRIVIA, type TriviaCategory, genreLabel } from "@vybz/core";
import { type Database, and, eq, gte, inArray, schema, sql } from "@vybz/db";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { isStaff } from "./battles/access";
import { createNotifications } from "./notifications";
import { type TriviaDrafter, type TriviaOptions, ensureTriviaBank, generateCatalogQuestions, insertDrafts } from "./trivia";

/**
 * The weekly trivia pipeline: AI drafts aimed at the thinnest genres and
 * categories, plus catalog questions, then a heads-up to staff to review.
 * Nothing reaches players until a moderator approves it.
 */

const JOB = "trivia-weekly";
const WEEK_MS = 7 * 86_400_000;
/** Below this many days of fresh daily questions, the pipeline runs early. */
const LOW_DAYS = 14;

export interface TriviaBankHealth {
  /** Approved questions not used in a daily set in the last 45 days. */
  fresh: number;
  approved: number;
  drafts: number;
  /** Days of daily challenges the fresh questions cover. */
  daysLeft: number;
  low: boolean;
  byCategory: { category: TriviaCategory; approved: number; drafts: number }[];
  /** Genres with the fewest approved questions first. */
  thinGenres: { genre: string; label: string; approved: number }[];
  lastRun: { at: string; note: string | null } | null;
  nextRun: string | null;
  aiReady: boolean;
}

export async function triviaBankHealth(db: Database, opts: TriviaOptions, drafter: TriviaDrafter | null): Promise<TriviaBankHealth> {
  await ensureTriviaBank(db);
  const q = schema.triviaQuestion;
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  const [counts, used, genres, [job]] = await Promise.all([
    db.select({ category: q.category, status: q.status, n: sql<number>`count(*)::int` }).from(q).groupBy(q.category, q.status),
    db
      .select({ id: sql<string>`unnest(${schema.triviaSet.questionIds})` })
      .from(schema.triviaSet)
      .where(and(eq(schema.triviaSet.mode, "DAILY"), gte(schema.triviaSet.day, since))),
    db
      .select({ genre: q.genre, n: sql<number>`count(*)::int` })
      .from(q)
      .where(and(eq(q.status, "APPROVED"), inArray(q.category, ["GENRE", "ARTIST", "HISTORY"])))
      .groupBy(q.genre),
    db.select().from(schema.jobRun).where(eq(schema.jobRun.key, JOB)),
  ]);
  const servable = (c: string) => opts.audioPreviews || c !== "GUESS_SONG";
  const approved = counts.filter((c) => c.status === "APPROVED" && servable(c.category)).reduce((a, c) => a + c.n, 0);
  const usedIds = [...new Set(used.map((u) => u.id))];
  const [{ usedApproved }] = (usedIds.length
    ? await db
        .select({ usedApproved: sql<number>`count(*)::int` })
        .from(q)
        .where(and(eq(q.status, "APPROVED"), inArray(q.id, usedIds)))
    : [{ usedApproved: 0 }]) as [{ usedApproved: number }];
  const fresh = Math.max(0, approved - usedApproved);
  const daysLeft = Math.floor(fresh / TRIVIA.questions);
  const g = new Map(genres.map((x) => [x.genre ?? "", x.n]));
  const cats: TriviaCategory[] = ["GENRE", "ARTIST", "ALBUM_ART", "HISTORY", "GUESS_SONG"];
  const last = job ? job.lastRunAt.getTime() : null;
  return {
    fresh,
    approved,
    drafts: counts.filter((c) => c.status === "DRAFT").reduce((a, c) => a + c.n, 0),
    daysLeft,
    low: daysLeft < LOW_DAYS,
    byCategory: cats.map((c) => ({
      category: c,
      approved: counts.find((x) => x.category === c && x.status === "APPROVED")?.n ?? 0,
      drafts: counts.find((x) => x.category === c && x.status === "DRAFT")?.n ?? 0,
    })),
    thinGenres: (GENRE_KEYS as string[]).map((k) => ({ genre: k, label: genreLabel(k), approved: g.get(k) ?? 0 })).sort((a, b) => a.approved - b.approved),
    lastRun: job ? { at: job.lastRunAt.toISOString(), note: job.note } : null,
    nextRun: last ? new Date(last + WEEK_MS).toISOString() : null,
    aiReady: !!drafter,
  };
}

/** Which (category, genre) batches to draft: thin genres first, spread over genre, artist and history questions. */
export function planBatches(thin: { genre: string; approved: number }[], total: number, perBatch = 10): { category: TriviaCategory; genre: string | null; count: number }[] {
  const cats: TriviaCategory[] = ["ARTIST", "GENRE", "HISTORY"];
  const out: { category: TriviaCategory; genre: string | null; count: number }[] = [];
  const genres = thin.map((t) => t.genre);
  let left = total;
  for (let i = 0; left > 0; i++) {
    const count = Math.min(perBatch, left);
    // Every fourth batch is general music history with no genre.
    const category = cats[i % cats.length]!;
    const genre = category === "HISTORY" && i % 2 === 0 ? null : (genres[i % Math.max(1, genres.length)] ?? null);
    out.push({ category, genre, count });
    left -= count;
  }
  return out;
}

export interface PipelineResult {
  ran: boolean;
  aiDrafts: number;
  skipped: number;
  catalog: number;
  note: string;
}

/**
 * Runs the pipeline if it's due: weekly, or daily while the bank is low.
 * `force` runs it now (from the staff screen). Safe to call every scheduler
 * tick: the job row is claimed with a conditional update, so it runs once.
 */
export async function runTriviaPipeline(
  deps: Pick<BattleDeps, "db" | "push">,
  opts: TriviaOptions,
  drafter: TriviaDrafter | null,
  { force = false, total = Number(process.env.TRIVIA_WEEKLY_DRAFTS) || 60, now = new Date() } = {},
): Promise<PipelineResult> {
  const db = deps.db as Database;
  const health = await triviaBankHealth(db, opts, drafter);
  const last = health.lastRun ? Date.parse(health.lastRun.at) : 0;
  const due = force || !last || now.getTime() - last >= WEEK_MS || (health.low && now.getTime() - last >= 86_400_000);
  if (!due) return { ran: false, aiDrafts: 0, skipped: 0, catalog: 0, note: "not due" };
  // Claim the run so two scheduler ticks can't both do it.
  const claimed = await db
    .insert(schema.jobRun)
    .values({ key: JOB, lastRunAt: now, note: "running" })
    .onConflictDoUpdate({
      target: schema.jobRun.key,
      set: { lastRunAt: now, note: "running" },
      setWhere: force ? sql`true` : sql`${schema.jobRun.lastRunAt} <= ${new Date(now.getTime() - (health.low ? 86_400_000 : WEEK_MS))}`,
    })
    .returning();
  if (!claimed.length) return { ran: false, aiDrafts: 0, skipped: 0, catalog: 0, note: "already running" };

  let aiDrafts = 0;
  let skipped = 0;
  const failures: string[] = [];
  if (drafter) {
    for (const b of planBatches(health.thinGenres, total)) {
      try {
        const r = await insertDrafts(db, drafter, null, b.category, b.genre, b.count);
        aiDrafts += r.added;
        skipped += r.skipped;
      } catch (err) {
        console.error("trivia pipeline batch failed", err);
        failures.push(`${b.category}${b.genre ? `/${b.genre}` : ""}`);
      }
    }
  }
  const catalog = await generateCatalogQuestions(db, 30).catch(() => 0);
  const note = drafter
    ? `${aiDrafts} AI drafts${skipped ? ` (${skipped} dropped)` : ""}, ${catalog} from the catalog${failures.length ? `; ${failures.length} batches failed` : ""}`
    : `${catalog} from the catalog. Set ANTHROPIC_API_KEY for weekly AI drafts.`;
  await db.update(schema.jobRun).set({ note }).where(eq(schema.jobRun.key, JOB));

  const fresh = await triviaBankHealth(db, opts, drafter);
  if (fresh.drafts > 0) {
    const staff = await db.select({ id: schema.user.id }).from(schema.user).where(and(inArray(schema.user.role, ["MODERATOR", "ADMIN"]), eq(schema.user.status, "ACTIVE")));
    await createNotifications(
      db,
      deps.push,
      staff.map((s) => ({
        userId: s.id,
        type: "TRIVIA_REVIEW" as const,
        title: "🧠 Trivia drafts to review",
        body: `${fresh.drafts} questions are waiting. ${fresh.daysLeft} days of daily trivia left.`,
        battleId: null,
        link: "/mod/trivia-review",
      })),
    );
  }
  return { ran: true, aiDrafts, skipped, catalog, note };
}

function requireStaff(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!isStaff(user)) throw new ServiceError(403, "FORBIDDEN");
  return user;
}

export async function adminBankHealth(deps: BattleDeps, opts: TriviaOptions, drafter: TriviaDrafter | null, viewer: UserRow | null): Promise<TriviaBankHealth> {
  requireStaff(viewer);
  return triviaBankHealth(deps.db, opts, drafter);
}

export async function adminRunPipeline(deps: BattleDeps, opts: TriviaOptions, drafter: TriviaDrafter | null, viewer: UserRow | null): Promise<PipelineResult & { health: TriviaBankHealth }> {
  requireStaff(viewer);
  const r = await runTriviaPipeline(deps, opts, drafter, { force: true, total: 30 });
  return { ...r, health: await triviaBankHealth(deps.db, opts, drafter) };
}
