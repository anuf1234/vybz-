import { randomBytes } from "node:crypto";
import { ARTIST_LINKS, type ArtistLinkKey, type ArtistPage, type ArtistProfileView, type WarSide, verdictScore } from "@vybz/core";
import { type Executor, and, desc, eq, inArray, newId, or, schema, sql } from "@vybz/db";
import { isStaff } from "./battles/access";
import { type BattleDeps, ServiceError, type UserRow } from "./battles/service";
import { views, warRef, verdictStats } from "./drops";
import { createNotifications, type NewNotification } from "./notifications";
import { createWar } from "./wars";

/**
 * Artist profiles and artist challenges. An artist claims their name, posts
 * a one-time code from an official account, and a moderator verifies it.
 * Verified artists get a badge, their own page (drops, followers, Fan
 * Verdict, war record) and can call out another artist: their release
 * against the other artist's, as a war both fan bases vote in.
 */

type ProfileRow = typeof schema.artistProfile.$inferSelect;
const key = (name: string) => name.trim().toLowerCase();

function requireUser(user: UserRow | null): UserRow {
  if (!user) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (user.status !== "ACTIVE") throw new ServiceError(403, "ACCOUNT_RESTRICTED");
  return user;
}

async function profileView(db: Executor, p: ProfileRow, viewer: UserRow | null): Promise<ArtistProfileView> {
  const [owner] = await db.select({ handle: schema.user.handle, name: schema.user.name }).from(schema.user).where(eq(schema.user.id, p.userId));
  const private_ = viewer?.id === p.userId || isStaff(viewer);
  return {
    id: p.id,
    name: p.name,
    status: p.status as ArtistProfileView["status"],
    bio: p.bio,
    links: p.links as ArtistProfileView["links"],
    owner: { handle: owner?.handle ?? "unknown", displayName: owner?.name ?? "" },
    code: private_ ? p.code : null,
    proofUrl: private_ ? p.proofUrl : null,
  };
}

function cleanLinks(raw: unknown): Partial<Record<ArtistLinkKey, string>> {
  const out: Partial<Record<ArtistLinkKey, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of ARTIST_LINKS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string" && /^https:\/\/[^\s]{4,300}$/.test(v.trim())) out[k] = v.trim();
  }
  return out;
}

/** Your claim (any status), or null. */
export async function myArtistProfile(deps: BattleDeps, viewer: UserRow | null): Promise<{ profile: ArtistProfileView | null; code: string }> {
  const user = requireUser(viewer);
  const [p] = await deps.db.select().from(schema.artistProfile).where(eq(schema.artistProfile.userId, user.id));
  // A fresh code to post, shown before claiming; the claim stores whichever code was shown.
  return { profile: p ? await profileView(deps.db, p, user) : null, code: p?.code ?? `VYBZ-${randomBytes(3).toString("hex").toUpperCase()}` };
}

/**
 * `{ name, code, proofUrl, bio?, links? }`. The proof is a public post from
 * one of the artist's official accounts showing the code. Re-claiming
 * replaces a pending or rejected claim; a verified profile can only update
 * its bio and links.
 */
export async function claimArtistProfile(deps: BattleDeps, viewer: UserRow | null, body: unknown): Promise<ArtistProfileView> {
  const user = requireUser(viewer);
  const b = (body ?? {}) as { name?: unknown; code?: unknown; proofUrl?: unknown; bio?: unknown; links?: unknown };
  const bio = typeof b.bio === "string" ? b.bio.trim().slice(0, 500) || null : null;
  const links = cleanLinks(b.links);
  const [existing] = await deps.db.select().from(schema.artistProfile).where(eq(schema.artistProfile.userId, user.id));
  if (existing?.status === "VERIFIED") {
    const [row] = await deps.db.update(schema.artistProfile).set({ bio, links }).where(eq(schema.artistProfile.id, existing.id)).returning();
    return profileView(deps.db, row!, user);
  }
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const code = typeof b.code === "string" ? b.code.trim() : "";
  const proofUrl = typeof b.proofUrl === "string" ? b.proofUrl.trim() : "";
  if (name.length < 1 || name.length > 100) throw new ServiceError(400, "INVALID_ARTIST", "Add your artist name as it appears on your releases.");
  if (!/^VYBZ-[0-9A-F]{6}$/.test(code)) throw new ServiceError(400, "INVALID_CODE", "Use the code shown on the claim screen.");
  if (!/^https:\/\/[^\s]{4,500}$/.test(proofUrl)) throw new ServiceError(400, "INVALID_PROOF", "Add a link to a public post from your official account showing the code.");
  const [taken] = await deps.db
    .select({ id: schema.artistProfile.id })
    .from(schema.artistProfile)
    .where(and(eq(schema.artistProfile.nameKey, key(name)), eq(schema.artistProfile.status, "VERIFIED")));
  if (taken) throw new ServiceError(409, "ARTIST_TAKEN", "That artist already has a verified profile. Contact support if it's you.");
  const values = { name, nameKey: key(name), code, proofUrl, bio, links, status: "PENDING", reviewedById: null, reviewedAt: null };
  const [row] = existing
    ? await deps.db.update(schema.artistProfile).set(values).where(eq(schema.artistProfile.id, existing.id)).returning()
    : await deps.db.insert(schema.artistProfile).values({ id: newId(), userId: user.id, ...values }).returning();
  const mods = await deps.db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(and(or(eq(schema.user.role, "MODERATOR"), eq(schema.user.role, "ADMIN")), eq(schema.user.status, "ACTIVE")));
  await createNotifications(
    deps.db,
    null,
    mods.map((m) => ({ userId: m.id, type: "ARTIST_DROP" as const, title: "🎤 Artist profile to verify", body: `@${user.handle} says they're ${name}.`, battleId: null, link: "/mod/artists" })),
  );
  return profileView(deps.db, row!, user);
}

export async function pendingArtistProfiles(deps: BattleDeps, viewer: UserRow | null): Promise<{ items: ArtistProfileView[] }> {
  if (!viewer) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!isStaff(viewer)) throw new ServiceError(403, "FORBIDDEN");
  const rows = await deps.db.select().from(schema.artistProfile).where(eq(schema.artistProfile.status, "PENDING")).orderBy(schema.artistProfile.createdAt).limit(100);
  return { items: await Promise.all(rows.map((r) => profileView(deps.db, r, viewer))) };
}

/** `{ action: "verify" | "reject" }` */
export async function reviewArtistProfile(deps: BattleDeps, viewer: UserRow | null, id: string, body: unknown): Promise<{ ok: true }> {
  if (!viewer) throw new ServiceError(401, "SIGN_IN_REQUIRED");
  if (!isStaff(viewer)) throw new ServiceError(403, "FORBIDDEN");
  const action = (body as { action?: unknown } | null)?.action;
  if (action !== "verify" && action !== "reject") throw new ServiceError(400, "INVALID_ACTION");
  let row: ProfileRow | undefined;
  try {
    [row] = await deps.db
      .update(schema.artistProfile)
      .set({ status: action === "verify" ? "VERIFIED" : "REJECTED", reviewedById: viewer.id, reviewedAt: new Date() })
      .where(and(eq(schema.artistProfile.id, id), eq(schema.artistProfile.status, "PENDING")))
      .returning();
  } catch {
    throw new ServiceError(409, "ARTIST_TAKEN", "Another account is already verified as this artist.");
  }
  if (!row) throw new ServiceError(404, "NOT_FOUND");
  await createNotifications(deps.db, deps.push, [
    {
      userId: row.userId,
      type: "ARTIST_DROP",
      title: action === "verify" ? `✓ You're verified as ${row.name}` : "Your artist profile wasn't verified",
      body: action === "verify" ? "Your artist page is live. Challenge another artist to a war!" : "We couldn't confirm it from the link. Check the post shows the code, then try again.",
      battleId: null,
      link: action === "verify" ? `/artist/${encodeURIComponent(row.name)}` : "/artist/claim",
    },
  ]);
  return { ok: true };
}

/** An artist's page: their profile if claimed, drops, followers, Fan Verdict and war record. Works for any artist name. */
export async function artistPage(deps: BattleDeps, viewer: UserRow | null, nameIn: string): Promise<ArtistPage> {
  const name = nameIn.trim().slice(0, 200);
  if (!name) throw new ServiceError(400, "INVALID_ARTIST");
  const k = key(name);
  const r = schema.release;
  const [profile, releases, followers, mine, wars] = await Promise.all([
    deps.db
      .select()
      .from(schema.artistProfile)
      .where(and(eq(schema.artistProfile.nameKey, k), eq(schema.artistProfile.status, "VERIFIED")))
      .then((x) => x[0]),
    deps.db
      .select()
      .from(r)
      .where(and(eq(r.status, "LIVE"), sql`lower(${r.artistName}) = ${k}`))
      .orderBy(desc(r.dropDay))
      .limit(30),
    deps.db
      .select({ n: sql<number>`count(distinct ${schema.artistFollow.userId})::int` })
      .from(schema.artistFollow)
      .where(sql`lower(${schema.artistFollow.name}) = ${k}`)
      .then((x) => x[0]?.n ?? 0),
    viewer
      ? deps.db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.artistFollow)
          .where(and(eq(schema.artistFollow.userId, viewer.id), sql`lower(${schema.artistFollow.name}) = ${k}`))
          .then((x) => (x[0]?.n ?? 0) > 0)
      : Promise.resolve(false),
    deps.db
      .select()
      .from(schema.war)
      .where(or(sql`lower(${schema.war.a}->>'artistName') = ${k}`, sql`lower(${schema.war.b}->>'artistName') = ${k}`))
      .orderBy(desc(schema.war.createdAt))
      .limit(50),
  ]);
  const ids = releases.map((x) => x.id);
  const [fires, verdicts] = await Promise.all([
    ids.length
      ? deps.db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.releaseFire)
          .where(inArray(schema.releaseFire.releaseId, ids))
          .then((x) => x[0]?.n ?? 0)
      : Promise.resolve(0),
    verdictStats(deps.db, ids),
  ]);
  const scored = [...verdicts.values()].filter((v) => v.games >= 5).map((v) => verdictScore(v.wins, v.games));
  const sideOf = (w: (typeof wars)[number]) => (key((w.a as WarSide).artistName) === k ? "A" : "B");
  const record = { won: 0, lost: 0, drawn: 0, open: 0 };
  const recent = wars.map((w) => {
    const side = sideOf(w);
    const result = w.status !== "CLOSED" ? null : w.winner === "DRAW" ? "DRAW" : w.winner === side ? "WON" : "LOST";
    if (w.status !== "CLOSED") record.open++;
    else if (result === "WON") record.won++;
    else if (result === "LOST") record.lost++;
    else record.drawn++;
    return { id: w.id, title: w.title, status: w.status, result, challenge: !!w.challenge } as ArtistPage["wars"]["recent"][number];
  });
  return {
    name: profile?.name ?? releases[0]?.artistName ?? name,
    profile: profile ? await profileView(deps.db, profile, viewer) : null,
    followers,
    following: mine,
    releases: await views(deps.db, viewer, releases),
    fires,
    verdict: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
    wars: { ...record, recent: recent.slice(0, 10) },
  };
}

/**
 * `{ mine: releaseId, theirs: releaseId }`: a verified artist's release
 * against another artist's, as a war (singles against singles, projects
 * against projects). Followers of both artists hear about it, and so does
 * the other artist if they're on VYBZ.
 */
export async function challengeArtist(deps: BattleDeps, viewer: UserRow | null, body: unknown) {
  const user = requireUser(viewer);
  const [me] = await deps.db
    .select()
    .from(schema.artistProfile)
    .where(and(eq(schema.artistProfile.userId, user.id), eq(schema.artistProfile.status, "VERIFIED")));
  if (!me) throw new ServiceError(403, "NOT_AN_ARTIST", "Only verified artists can challenge other artists.");
  const b = (body ?? {}) as { mine?: unknown; theirs?: unknown };
  if (typeof b.mine !== "string" || typeof b.theirs !== "string") throw new ServiceError(400, "INVALID_REQUEST");
  const rows = await deps.db.select().from(schema.release).where(and(inArray(schema.release.id, [b.mine, b.theirs]), eq(schema.release.status, "LIVE")));
  const mine = rows.find((x) => x.id === b.mine);
  const theirs = rows.find((x) => x.id === b.theirs);
  if (!mine || !theirs) throw new ServiceError(404, "NOT_FOUND");
  if (key(mine.artistName) !== me.nameKey) throw new ServiceError(403, "NOT_YOUR_RELEASE", "Pick one of your own releases.");
  if (key(theirs.artistName) === me.nameKey) throw new ServiceError(400, "SAME_ARTIST", "Pick another artist's release.");
  if (mine.provider === "SUBMISSION" || theirs.provider === "SUBMISSION") throw new ServiceError(400, "NOT_WARRABLE", "Mixtapes can't go to war yet.");
  const single = mine.kind === "SINGLE";
  if (single !== (theirs.kind === "SINGLE")) throw new ServiceError(400, "KIND_MISMATCH", "Singles face singles; albums and EPs face albums and EPs.");
  const [a, bRef] = await Promise.all([warRef(deps, mine), warRef(deps, theirs)]);
  if (!a || !bRef) throw new ServiceError(409, "NOT_WARRABLE", "One of those can't be put in a war right now.");
  const war = await createWar(deps, user, { kind: single ? "SINGLE" : "ALBUM", a, b: bRef }, { challenge: { from: me.name, to: theirs.artistName, fromHandle: user.handle } });

  // Followers of both artists, and the other artist if they're verified on VYBZ.
  const f = schema.artistFollow;
  const fans = await deps.db
    .selectDistinct({ userId: f.userId })
    .from(f)
    .where(inArray(sql`lower(${f.name})`, [me.nameKey, key(theirs.artistName)]));
  const [rival] = await deps.db
    .select({ userId: schema.artistProfile.userId })
    .from(schema.artistProfile)
    .where(and(eq(schema.artistProfile.nameKey, key(theirs.artistName)), eq(schema.artistProfile.status, "VERIFIED")));
  const notes: NewNotification[] = fans
    .filter((x) => x.userId !== user.id && x.userId !== rival?.userId)
    .map((x) => ({ userId: x.userId, type: "WAR_RESULT", title: `⚔️ ${me.name} challenged ${theirs.artistName}`, body: `${mine.title} vs ${theirs.title}. Your vote decides it.`, battleId: null, link: `/wars/${war.id}` }));
  if (rival && rival.userId !== user.id) notes.push({ userId: rival.userId, type: "WAR_RESULT", title: `⚔️ ${me.name} called you out`, body: `${mine.title} vs your ${theirs.title}. Rally your fans!`, battleId: null, link: `/wars/${war.id}` });
  await createNotifications(deps.db, deps.push, notes);
  return war;
}
